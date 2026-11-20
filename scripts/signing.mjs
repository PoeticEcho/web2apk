#!/usr/bin/env node
/**
 * 릴리스 서명 설정(선택).
 *
 * 다음 시크릿이 모두 있을 때만 동작한다.
 *   ANDROID_KEYSTORE_BASE64  : 릴리스 키스토어(.jks)를 base64 로 인코딩한 값
 *   ANDROID_KEYSTORE_PASSWORD: 키스토어 비밀번호
 *   ANDROID_KEY_ALIAS        : 키 별칭
 *   ANDROID_KEY_PASSWORD     : 키 비밀번호 (생략 시 키스토어 비밀번호와 동일)
 *
 * 없으면 아무 것도 하지 않고 debug 빌드로 진행한다(서명 없는 release APK 는 설치할 수 없기 때문).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const keystoreBase64 = process.env.ANDROID_KEYSTORE_BASE64?.trim();
const storePassword = process.env.ANDROID_KEYSTORE_PASSWORD;
const keyAlias = process.env.ANDROID_KEY_ALIAS;
const keyPassword = process.env.ANDROID_KEY_PASSWORD || storePassword;

const enabled = Boolean(keystoreBase64 && storePassword && keyAlias);

if (!enabled) {
  console.log('[web2apk] 서명 시크릿이 없어 debug 빌드로 진행합니다.');
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) writeFileSync(outputPath, 'signed=false\nassemble_task=assembleDebug\napk_glob=debug\n', { flag: 'a' });
  process.exit(0);
}

const androidApp = path.join(root, 'android', 'app');
if (!existsSync(path.join(androidApp, 'build.gradle'))) {
  console.error('[web2apk] android/app/build.gradle 이 없습니다. patch 단계 뒤에 실행해 주세요.');
  process.exit(1);
}

const keystorePath = path.join(androidApp, 'web2apk-release.keystore');
writeFileSync(keystorePath, Buffer.from(keystoreBase64, 'base64'));

const gradlePath = path.join(androidApp, 'build.gradle');
const current = readFileSync(gradlePath, 'utf8');
if (!current.includes('web2apk-signing')) {
  const block = `
// web2apk-signing: 시크릿으로 넘어온 키스토어로 release 서명
android {
    signingConfigs {
        web2apkRelease {
            storeFile file("web2apk-release.keystore")
            storePassword System.getenv("WEB2APK_STORE_PASSWORD")
            keyAlias System.getenv("WEB2APK_KEY_ALIAS")
            keyPassword System.getenv("WEB2APK_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.web2apkRelease
        }
    }
}
`;
  writeFileSync(gradlePath, `${current}\n${block}`);
}

const outputPath = process.env.GITHUB_OUTPUT;
if (outputPath) {
  writeFileSync(outputPath, 'signed=true\nassemble_task=assembleRelease\napk_glob=release\n', { flag: 'a' });
}

console.log('[web2apk] release 서명 설정 완료 → assembleRelease 로 빌드합니다.');
