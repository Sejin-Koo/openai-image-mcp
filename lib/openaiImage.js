// OpenAI Images API 호출 헬퍼 (gpt-image 계열)
// 문서: https://developers.openai.com/api/reference/resources/images/methods/generate

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";

const ALLOWED_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
const ALLOWED_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048"];
const ALLOWED_QUALITY = ["auto", "low", "medium", "high"];

/**
 * @param {object} args
 * @param {string} args.prompt
 * @param {string} [args.model]
 * @param {string} [args.size]
 * @param {string} [args.quality]
 * @param {string} [args.output_format]
 * @returns {Promise<{ base64: string, mimeType: string, model: string, size: string }>}
 */
async function generateImage(args) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다. Vercel 프로젝트 설정 > Environment Variables에 등록하세요."
    );
  }

  const prompt = (args && args.prompt || "").trim();
  if (!prompt) {
    throw new Error("prompt 파라미터는 필수입니다.");
  }

  const model = ALLOWED_MODELS.includes(args.model) ? args.model : "gpt-image-2";
  const size = ALLOWED_SIZES.includes(args.size) ? args.size : "1024x1024";
  const quality = ALLOWED_QUALITY.includes(args.quality) ? args.quality : "medium";
  const output_format = ["png", "jpeg", "webp"].includes(args.output_format)
    ? args.output_format
    : "png";

  const body = {
    model,
    prompt,
    size,
    quality,
    output_format,
    n: 1,
  };

  const res = await fetch(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (json && json.error && json.error.message) || `OpenAI API 오류 (HTTP ${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.raw = json;
    throw err;
  }

  const item = json && json.data && json.data[0];
  if (!item || !item.b64_json) {
    throw new Error("OpenAI 응답에 이미지 데이터(b64_json)가 없습니다.");
  }

  const mimeType = output_format === "jpeg" ? "image/jpeg" : output_format === "webp" ? "image/webp" : "image/png";

  return {
    base64: item.b64_json,
    mimeType,
    model,
    size,
  };
}

module.exports = { generateImage, ALLOWED_MODELS, ALLOWED_SIZES, ALLOWED_QUALITY };
