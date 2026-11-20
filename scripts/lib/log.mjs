/** 아주 작은 로거. GitHub Actions 로그에서도 읽기 좋게 접두사를 붙인다. */
export function createLogger({ quiet = false, verbose = false, prefix = 'web2apk' } = {}) {
  const stamp = () => new Date().toISOString().slice(11, 19);
  const log = {
    step(message) {
      if (!quiet) console.log(`\n[${prefix}] ${message}`);
    },
    info(message) {
      if (!quiet) console.log(message);
    },
    warn(message) {
      console.log(message.startsWith('  ') ? message : `  ${message}`);
    },
    debug(message) {
      if (verbose) console.log(`  [debug] ${stamp()} ${message}`);
    },
    error(message) {
      console.error(message);
    },
    plain(message) {
      console.log(message);
    },
  };
  return log;
}
