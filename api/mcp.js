// OpenAI 이미지 생성 MCP 서버 (Vercel Serverless Function, 커스텀 JSON-RPC 핸들러)
// 엔드포인트: POST /api/mcp
// 인증: OPENAI_API_KEY 환경변수 (Vercel 프로젝트 설정에서 등록)

const { generateImage, ALLOWED_MODELS, ALLOWED_SIZES, ALLOWED_QUALITY } = require("../lib/openaiImage");

const SERVER_INFO = { name: "openai-image-mcp", version: "1.0.0" };

// 접근 게이트 설정 — 상세 설명은 아래 핸들러의 "접근 게이트" 블록 참조
const GATE_KEYS = (process.env.MCP_GATE_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const GATE_MODE = (process.env.MCP_GATE_MODE || "observe").trim().toLowerCase();

function keyLabel(k) {
  if (!k) return "(none)";
  const m = String(k).match(/^plk_([A-Za-z0-9]+)_/);
  return m ? m[1] : `${String(k).slice(0, 8)}…`;
}
const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "generate_image",
    title: "이미지 생성 (OpenAI GPT Image)",
    description:
      "OpenAI GPT Image API로 텍스트 프롬프트에 맞는 이미지를 생성합니다. PPT/워드 문서 등에 삽입할 문맥에 맞는 이미지를 만들 때 사용하세요. 결과는 base64 PNG/JPEG/WebP 데이터로 반환됩니다.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "생성할 이미지에 대한 상세한 텍스트 설명 (한글/영문 모두 가능, 영문 권장)",
        },
        model: {
          type: "string",
          enum: ALLOWED_MODELS,
          default: "gpt-image-2",
          description: "사용할 모델 (기본값: gpt-image-2)",
        },
        size: {
          type: "string",
          enum: ALLOWED_SIZES,
          default: "1024x1024",
          description: "이미지 크기",
        },
        quality: {
          type: "string",
          enum: ALLOWED_QUALITY,
          default: "medium",
          description: "이미지 품질 (low가 가장 저렴/빠름)",
        },
        output_format: {
          type: "string",
          enum: ["png", "jpeg", "webp"],
          default: "png",
          description: "출력 파일 형식",
        },
      },
      required: ["prompt"],
    },
  },
];

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRpc(payload) {
  const { id = null, method, params } = payload || {};

  switch (method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "ping":
      return jsonRpcResult(id, {});

    case "tools/list":
      return jsonRpcResult(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = params && params.name;
      const args = (params && params.arguments) || {};

      if (toolName !== "generate_image") {
        return jsonRpcError(id, -32602, `알 수 없는 도구입니다: ${toolName}`);
      }

      try {
        const { base64, mimeType, model, size } = await generateImage(args);
        return jsonRpcResult(id, {
          content: [
            {
              type: "text",
              text: `이미지 생성 완료 (model=${model}, size=${size})`,
            },
            {
              type: "image",
              data: base64,
              mimeType,
            },
          ],
          isError: false,
        });
      } catch (err) {
        return jsonRpcResult(id, {
          content: [{ type: "text", text: `이미지 생성 실패: ${err.message}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonRpcError(id, -32601, `지원하지 않는 method입니다: ${method}`);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, mcp-protocol-version");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // ─── 접근 게이트 ───────────────────────────────────────────────────────────
  // 이 서버는 호출 1회가 곧 OpenAI 실제 과금이므로, 주소만 알면 누구나 호출할 수
  // 있는 상태를 막는다. 호출자는 URL 쿼리스트링으로 게이트키를 전달한다:
  //   https://<도메인>/api/mcp?k=<발급키>
  // MCP_GATE_KEYS 가 비어 있으면 게이트 비활성(모두 통과), MCP_GATE_MODE 가
  // "enforce" 면 키가 없거나 목록에 없을 때 401 차단, 그 밖이면 로그만 남긴다.
  {
    let gk = (req.query && req.query.k) || null;
    if (!gk) {
      try {
        gk = new URL(req.url, "http://localhost").searchParams.get("k");
      } catch (e) {
        gk = null;
      }
    }
    const allowed = GATE_KEYS.length === 0 || (!!gk && GATE_KEYS.includes(gk));
    console.log(`[gate] mode=${GATE_MODE} caller=${keyLabel(gk)} allowed=${allowed}`);
    if (!allowed && GATE_MODE === "enforce") {
      res.status(401).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32001,
          message:
            "접근 권한이 없습니다. 이 서버는 발급받은 게이트키가 포함된 주소(…/api/mcp?k=<발급키>)로만 호출할 수 있습니다.",
        },
      });
      return;
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(405).json({ error: "이 엔드포인트는 POST만 지원합니다 (stateless JSON-RPC)." });
    return;
  }

  let body = req.body;
  if (!body || typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch (e) {
      res.status(400).json({ error: "잘못된 JSON 요청 본문입니다." });
      return;
    }
  }

  try {
    if (Array.isArray(body)) {
      const results = await Promise.all(body.map(handleRpc));
      res.status(200).json(results);
    } else {
      const result = await handleRpc(body);
      res.status(200).json(result);
    }
  } catch (err) {
    res.status(500).json(jsonRpcError((body && body.id) || null, -32000, err.message));
  }
};
