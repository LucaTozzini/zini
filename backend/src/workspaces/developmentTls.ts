import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, chmod } from "node:fs/promises";
import { createPrivateKey, X509Certificate } from "node:crypto";

const folder = "/state/dev-tls";
export const developmentTlsPaths = { key: `${folder}/key.pem`, cert: `${folder}/cert.pem` };
export async function generateDevelopmentTls() {
  await mkdir(folder, { recursive: true });
  let reused = false;
  try {
    const cert = new X509Certificate(await readFile(developmentTlsPaths.cert));
    reused = cert.checkPrivateKey(createPrivateKey(await readFile(developmentTlsPaths.key))) && Date.parse(cert.validTo) > Date.now();
  } catch { /* Generate the pair when absent or unusable. */ }
  if (!reused) {
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
      "-keyout", `${developmentTlsPaths.key}.tmp`, "-out", `${developmentTlsPaths.cert}.tmp`]);
    await chmod(`${developmentTlsPaths.key}.tmp`, 0o600);
    await rename(`${developmentTlsPaths.key}.tmp`, developmentTlsPaths.key);
    await rename(`${developmentTlsPaths.cert}.tmp`, developmentTlsPaths.cert);
  }
  return { ...developmentTlsPaths, reused };
}
