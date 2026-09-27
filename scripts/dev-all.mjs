import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serviceDir = path.join(root, "transcript-service");
const venvDir = path.join(serviceDir, ".venv");
const venvPython = path.join(venvDir, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const requirements = path.join(serviceDir, "requirements.txt");
const marker = path.join(venvDir, ".requirements-sha256");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
}

function findPython() {
  for (const command of ["python3.11", "python3"]) {
    const result = spawnSync(command, ["-c", "import sys; print(int(sys.version_info >= (3, 11)))"], {
      encoding: "utf8",
    });
    if (result.status === 0 && result.stdout.trim() === "1") return command;
  }
  throw new Error("Python 3.11 or newer is required for the transcript service.");
}

function ensureTranscriptRuntime() {
  if (!existsSync(venvPython)) {
    console.log("Creating the transcript service Python environment...");
    run(findPython(), ["-m", "venv", venvDir]);
  }

  const hash = createHash("sha256").update(readFileSync(requirements)).digest("hex");
  const installedHash = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
  if (installedHash !== hash) {
    console.log("Installing transcript service dependencies...");
    run(venvPython, ["-m", "pip", "install", "-r", requirements]);
    writeFileSync(marker, `${hash}\n`);
  }
}

function startService(name, command, args, cwd = root, env = {}) {
  console.log(`Starting ${name}...`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  return {
    name,
    child,
    stop() {
      if (!child.pid || child.exitCode !== null) return;
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") console.error(`Could not stop ${name}:`, error);
      }
    },
  };
}

/** @param {import('node:events').EventEmitter} [host] */
export function superviseServices(services, host = process) {
  return new Promise((resolve) => {
    let finished = false;
    const onInterrupt = () => finish(130);
    const onTerminate = () => finish(143);

    function finish(code, exitedService) {
      if (finished) return;
      finished = true;
      host.off("SIGINT", onInterrupt);
      host.off("SIGTERM", onTerminate);
      for (const service of services) {
        if (service !== exitedService) service.stop();
      }
      resolve(code);
    }

    host.on("SIGINT", onInterrupt);
    host.on("SIGTERM", onTerminate);
    for (const service of services) {
      service.child.once("exit", (code) => {
        if (!finished) console.error(`${service.name} stopped. Stopping the other services.`);
        finish(code || 1, service);
      });
      service.child.once("error", (error) => {
        console.error(`${service.name} could not start:`, error);
        finish(1, service);
      });
    }
  });
}

async function main() {
  try {
    run(process.execPath, [path.join(root, "scripts/check-local-setup.mjs")]);
    ensureTranscriptRuntime();
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const serviceToken = process.env.TRANSCRIPT_SERVICE_TOKEN || randomBytes(32).toString("hex");
    const transcriptEnv = { TRANSCRIPT_SERVICE_TOKEN: serviceToken };
    const services = [
      startService("Convex", npm, ["run", "convex:dev"]),
      startService("Transcript", venvPython, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8765", "--reload"], serviceDir, transcriptEnv),
      startService("Next.js", npm, ["run", "dev"], root, transcriptEnv),
    ];
    process.exitCode = await superviseServices(services);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
