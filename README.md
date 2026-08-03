# openai-image-mcp

OpenAI GPT Image API를 감싼 MCP 서버 (포니링크 IT사업본부). PPT/워드 문서 등에 삽입할
문맥에 맞는 이미지를 프롬프트로 생성하는 `generate_image` 도구 하나를 제공합니다.

## 로컬 스모크테스트

```bash
export OPENAI_API_KEY="sk-..."
node scripts/smoketest.js
```

`tmp-output/smoketest.png`에 생성된 이미지가 저장되면 정상 동작하는 것입니다.
(저비용 옵션 `quality: low`, `size: 1024x1024`으로 호출하며, 실제 OpenAI API 과금이 발생합니다.)

## Vercel 배포

1. GitHub 레포에 push한 뒤 Vercel에서 Import
2. 프로젝트 Settings > Environment Variables에 `OPENAI_API_KEY` 등록 (Production/Preview 모두)
3. 배포 완료 후 엔드포인트: `https://<repo>.vercel.app/api/mcp`

## MCP 엔드포인트 직접 호출 (curl)

```bash
curl -s -X POST "https://<repo>.vercel.app/api/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```bash
curl -s -X POST "https://<repo>.vercel.app/api/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{
      "name":"generate_image",
      "arguments":{"prompt":"minimalist icon of a handshake, flat design","quality":"low"}
    }
  }'
```

## claude.ai / Cowork에 연결

Settings > Connectors (또는 Capabilities) > "+" > Add custom connector 에서
`https://<repo>.vercel.app/api/mcp` 를 등록합니다.

## 인증

`OPENAI_API_KEY` 환경변수를 서버가 직접 들고 있으므로, 클라이언트(Claude)가 매 호출마다
키를 넘길 필요는 없습니다.

## 과금 안내

OpenAI 이미지 생성 API는 무료 티어가 없습니다. `generate_image` 호출 1회 = 실제 과금
1회입니다 (2026-08 기준 gpt-image-2, 1K 해상도 장당 약 $0.03 — 정확한 최신 가격은
OpenAI 공식 가격 페이지에서 확인).
