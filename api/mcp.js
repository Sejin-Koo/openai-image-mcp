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
// ── MCP 프로토콜 버전 협상 ──────────────────────────────────────────────────
// 규격 근거 두 가지.
//  (1) Lifecycle "Version Negotiation": 서버는 요청받은 버전을 지원하면 같은 값으로,
//      지원하지 않으면 "자기가 지원하는" 다른 버전으로 응답해야 한다(MUST).
//  (2) Transports "Protocol Version Header": MCP-Protocol-Version 헤더가 미지원
//      버전이면 400 Bad Request 로 응답해야 한다(MUST). 이 400은 신형(2026-07-28)
//      클라이언트가 HTTP에서 구형 서버를 판별해 폴백하는 유일한 신호이기도 하므로,
//      200 으로 통과시키면 신형 클라이언트가 이 서버를 신형으로 오인한다.
// 목록은 @modelcontextprotocol/sdk 의 SUPPORTED_PROTOCOL_VERSIONS 와 동일하게 맞춰,
// SDK 기반 서버들과 협상 결과가 갈리지 않도록 한다.
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

function negotiateProtocolVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

// 헤더가 없으면 통과한다(규격상 서버는 2025-03-26 으로 간주). 값이 있으면 대조한다.
function protocolVersionHeaderError(req) {
  const raw = req.headers && req.headers["mcp-protocol-version"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || SUPPORTED_PROTOCOL_VERSIONS.includes(v)) return null;
  return {
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: `Bad Request: Unsupported protocol version: ${v} (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`,
    },
    id: null,
  };
}

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
        protocolVersion: negotiateProtocolVersion(params && params.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

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

  const pvError = protocolVersionHeaderError(req);
  if (pvError) {
    res.status(400).json(pvError);
    return;
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

  // 알림(notification)에는 응답 본문이 없어야 한다 — 규격상 202 Accepted.
  if (!Array.isArray(body) && typeof (body && body.method) === "string" && body.method.startsWith("notifications/")) {
    res.status(202).end();
    return;
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
