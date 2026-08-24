// 관리자 계정에 admin custom claim을 부여하는 1회성 스크립트입니다. (외부 npm 패키지 불필요)
// Node.js 내장 모듈(crypto, fetch)만 사용해 Google OAuth2 서비스 계정 인증 →
// Identity Toolkit REST API 호출로 커스텀 클레임을 설정합니다.
//
// 사용법:
//   1. Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > "새 비공개 키 생성" 으로
//      service-account.json 을 내려받아 scripts/ 폴더에 둡니다. (git에 커밋 금지!)
//   2. node scripts/setAdminClaim.js admin@example.com
//
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const email = process.argv[2];

if (!email) {
  console.error('사용법: node scripts/setAdminClaim.js <admin-email>');
  process.exit(1);
}

const serviceAccountPath = path.join(__dirname, 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key).toString('base64url');
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OAuth2 토큰 발급 실패: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function main() {
  const projectId = serviceAccount.project_id;
  const accessToken = await getAccessToken();
  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // 1. 이메일로 사용자 조회
  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
    { method: 'POST', headers: authHeaders, body: JSON.stringify({ email: [email] }) }
  );
  const lookupData = await lookupRes.json();
  if (!lookupRes.ok) throw new Error(`사용자 조회 실패: ${JSON.stringify(lookupData)}`);
  if (!lookupData.users || lookupData.users.length === 0) {
    throw new Error(`${email} 계정을 찾을 수 없습니다. Authentication에서 먼저 계정을 생성해주세요.`);
  }
  const uid = lookupData.users[0].localId;

  // 2. 커스텀 클레임(admin: true) 설정
  const updateRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ admin: true }) }),
    }
  );
  const updateData = await updateRes.json();
  if (!updateRes.ok) throw new Error(`권한 부여 실패: ${JSON.stringify(updateData)}`);

  console.log(`${email} (uid: ${uid}) 계정에 admin 권한을 부여했습니다.`);
  console.log('해당 계정으로 다시 로그인해야 권한이 적용됩니다.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
