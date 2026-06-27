# 🎵 디스코드 음악봇 (discord.js v14)

버튼/모달 UI 기반의 자체 내장 음악봇입니다. yt-dlp와 ffmpeg가 패키지에 포함되어 **별도 설치가 필요 없습니다.**

## 기능
- **봇을 서버에 초대하면 자동으로 "세팅 하시겠습니까?" 안내**가 뜸 → **세팅하기** 버튼을 누르면 봇이 전용 채널(`🎵-음악봇`)을 직접 만들고 그 안에 컨트롤 패널을 설치
- (이미 들어와 있는 서버라면 `/셋업` 명령어로 동일하게 설치)
- **🔗 추가** 버튼 → 모달 창에 유튜브 링크 또는 검색어 입력
- 재생목록(`list=`) 링크 → "재생목록 전체 추가 / 이 곡만 추가" 선택
- **⏸️ 일시정지 · ⏭️ 스킵 · ⏹️ 정지 · 📜 대기열** 버튼
- 대기열 자동 재생

## 1. 봇 만들기 (디스코드 개발자 포털)
1. https://discord.com/developers/applications → **New Application**
2. 좌측 **Bot** → **Reset Token** 으로 토큰 발급 → 복사
3. **Privileged Gateway Intents** 는 전부 꺼도 됩니다(이 봇은 필요 없음)
4. 좌측 **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Manage Channels`, `Connect`, `Speak`, `Send Messages`, `Use Slash Commands`
     - ⚠️ `Manage Channels`(채널 관리)는 봇이 전용 음악 채널을 직접 만들기 위해 필요합니다.
   - 생성된 URL로 봇을 내 서버에 초대

## 2. 설정
```bash
cp .env.example .env
```
`.env` 파일을 열어 채웁니다:
- `DISCORD_TOKEN` : 위에서 발급한 봇 토큰
- `CLIENT_ID` : 개발자 포털 **General Information**의 Application ID
- `GUILD_ID` : (선택) 내 서버 ID. 넣으면 명령어가 **즉시** 등록됨. 비우면 전역(최대 1시간 소요)

## 3. 설치 & 실행
```bash
npm install
npm start
```
`🤖 로그인: ...` 이 뜨면:
- 봇을 **새 서버에 초대**하면 자동으로 세팅 안내가 뜹니다 → **세팅하기** 클릭.
- 이미 들어와 있는 서버라면 `/셋업` 입력.
- 만들어진 `🎵-음악봇` 채널에서 음성 채널 입장 후 **🔗 추가**.

## 문제 해결
- **소리가 안 나요**: 봇이 음성 채널 `연결/말하기` 권한이 있는지, 본인이 음성 채널에 있는지 확인.
- **`@discordjs/opus` 설치 실패** (빌드 도구 없음): `npm install opusscript` 후 자동 대체됩니다(순수 JS, 약간 느림).
- **재생이 끊겨요**: 네트워크/유튜브 제한일 수 있음. yt-dlp 업데이트: `npx youtube-dl-exec --update` 또는 패키지 재설치.
