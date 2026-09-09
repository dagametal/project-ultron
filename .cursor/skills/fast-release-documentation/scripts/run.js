const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "../../../..");
const SMOKE_JS = path.join(
  ROOT,
  "prod-release/create-basic-smoke-test-execution.js",
);
const PLAN_JS = path.join(ROOT, "prod-release/create-test-plan.js");

const CANALES = {
  1: "1",
  bm: "1",
  mb: "1",
  mobile: "1",
  "banca mobile": "1",
  "banca-mobile": "1",
  2: "2",
  pb: "2",
  pv: "2",
  portal: "2",
  "portal bancario": "2",
  "portal-bancario": "2",
};

function extraerNumeroVersion(texto) {
  const match = String(texto || "").match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function normalizarCanal(texto) {
  const clave = String(texto || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return CANALES[clave] || null;
}

function preguntar(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(texto, (respuesta) => {
      rl.close();
      resolve(respuesta.trim());
    });
  });
}

async function resolverVersion(desdeArgs) {
  let input = desdeArgs;
  while (!extraerNumeroVersion(input)) {
    input = await preguntar("Número de release (ej. 4.11.1): ");
    if (!extraerNumeroVersion(input)) {
      console.log("Debe ser una versión tipo x.x.x.\n");
    }
  }
  return extraerNumeroVersion(input);
}

async function resolverCanal(desdeArgs) {
  let opcion = normalizarCanal(desdeArgs);
  while (!opcion) {
    const respuesta = await preguntar(
      "Canal (BM/MB = Banca Mobile, PB/PV = Portal Bancario): ",
    );
    opcion = normalizarCanal(respuesta);
    if (!opcion) {
      console.log("Canal inválido. Usa BM, MB, PB o PV.\n");
    }
  }
  return opcion;
}

function runNode(script, args, stdinText) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      stdio: [stdinText ? "pipe" : "ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${path.basename(script)} salió con código ${code}.\n${stderr}`.trim(),
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });

    if (stdinText) {
      child.stdin.write(stdinText);
      child.stdin.end();
    }
  });
}

function extraerKeyTE(stdout) {
  const match = stdout.match(/Creado\s+(AVCD-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function main() {
  const args = process.argv.slice(2);
  const version = await resolverVersion(args[0]);
  const canal = await resolverCanal(args[1]);
  const nombreCanal = canal === "1" ? "Banca Mobile" : "Portal Bancario";

  console.log(`\n🚀 Humo básico ${version} — ${nombreCanal}\n`);
  const smoke = await runNode(SMOKE_JS, [version], `${canal}\n`);

  const teKey = extraerKeyTE(smoke.stdout);
  if (!teKey) {
    throw new Error(
      "No encontré la key del Test Execution en la salida (AVCD-####). No creo el Test Plan.",
    );
  }

  const teNumero = teKey.split("-")[1];
  console.log(`\n📌 TE pendiente: ${teKey} (número ${teNumero})\n`);
  console.log(`🚀 Test Plan ${version} — asocia ${teNumero}, estado Terminado\n`);

  const plan = await runNode(PLAN_JS, [
    version,
    "--te",
    teNumero,
    "--terminado",
  ]);
  const planKey = extraerKeyTE(plan.stdout);

  console.log(`\n✅ Documentación de release ${version} (${nombreCanal})`);
  console.log(`   TE:   ${teKey}`);
  if (planKey) console.log(`   Plan: ${planKey}`);
}

main().catch((error) => {
  console.error("❌", error.message || error);
  process.exitCode = 1;
});
