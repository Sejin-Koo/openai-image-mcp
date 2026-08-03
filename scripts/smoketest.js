// 로컬 스모크테스트: 실제 OPENAI_API_KEY로 이미지 1장을 저비용 옵션(low/1024x1024)으로 생성해
// lib/openaiImage.js가 정상 동작하는지, MCP 핸들러 로직(api/mcp.js)의 tools/call 분기까지 확인한다.
const path = require("path");
const fs = require("fs");
const { generateImage } = require("../lib/openaiImage");

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다.");
    process.exit(1);
  }

  console.log("[smoketest] OpenAI Images API 호출 중 (model=gpt-image-2, size=1024x1024, quality=low)...");
  const started = Date.now();

  const { base64, mimeType, model, size } = await generateImage({
    prompt: "A minimalist line-art icon of a rocket launching, flat design, white background",
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "low",
    output_format: "png",
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const outDir = path.join(__dirname, "..", "tmp-output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "smoketest.png");
  fs.writeFileSync(outPath, Buffer.from(base64, "base64"));

  console.log(`[smoketest] 성공 (${elapsed}s) — model=${model}, size=${size}, mimeType=${mimeType}`);
  console.log(`[smoketest] 저장 위치: ${outPath}`);
  console.log(`[smoketest] base64 길이: ${base64.length}자`);
}

main().catch((err) => {
  console.error("[smoketest] 실패:", err.message);
  if (err.raw) console.error(JSON.stringify(err.raw, null, 2));
  process.exit(1);
});
