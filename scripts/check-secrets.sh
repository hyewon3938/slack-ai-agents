#!/bin/bash
# 커밋 전 민감정보 유출 스캔
# staged 파일에서 API 키, 토큰, 비밀번호 패턴을 검사

PATTERNS=(
  'SLACK_BOT_TOKEN\s*='
  'SLACK_APP_TOKEN\s*='
  'ANTHROPIC_API_KEY\s*='
  'GEMINI_API_KEY\s*='
  'GROQ_API_KEY\s*='
  'DATABASE_URL\s*='
  'DB_PASSWORD\s*='
  'xoxb-[0-9]'
  'xapp-[0-9]'
  'sk-ant-'
  'gsk_'
  'AIza'
  'password\s*=\s*["\x27][^"\x27]+'
)

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

FOUND=0
for pattern in "${PATTERNS[@]}"; do
  MATCHES=$(echo "$STAGED_FILES" | xargs grep -lnE "$pattern" 2>/dev/null | grep -v '.env.example' | grep -v 'check-secrets.sh')
  if [ -n "$MATCHES" ]; then
    if [ $FOUND -eq 0 ]; then
      echo "!! 민감정보 유출 의심 !!"
      FOUND=1
    fi
    echo "패턴 '$pattern' 발견:"
    echo "$MATCHES" | while read -r file; do
      echo "  - $file"
    done
  fi
done

if [ $FOUND -ne 0 ]; then
  echo ""
  echo "위 파일에 API 키나 비밀번호가 포함되어 있을 수 있습니다."
  echo "확인 후 진행하세요."
  exit 1
fi

exit 0
