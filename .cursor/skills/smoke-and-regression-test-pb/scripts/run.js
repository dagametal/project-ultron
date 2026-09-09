const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const axios = require("axios");

const ROOT = path.resolve(__dirname, "../../../..");
const {
  JIRA_URL,
  EMAIL,
  API_TOKEN,
  PROJECT_KEY,
  XRAY_CLIENT_ID,
  XRAY_CLIENT_SECRET,
  XRAY_BASE_URL = "https://xray.cloud.getxray.app",
} = require(path.join(ROOT, "jira-config"));

const SMOKE_JS = path.join(
  ROOT,
  "prod-release/create-complete-smoke-test-execution.js",
);
const REGRESSION_JS = path.join(
  ROOT,
  "prod-release/create-functional-test-execution.js",
);
const ESTADO_EN_PRUEBAS = "En pruebas";

const auth = { username: EMAIL, password: API_TOKEN };
const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

function extraerNumeroVersion(texto) {
  const match = String(texto || "").match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function normalizar(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizarEstado(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolverKey(input) {
  const valor = String(input || "").trim().toUpperCase();
  if (/^\d+$/.test(valor)) return `${PROJECT_KEY}-${valor}`;
  if (/^([A-Z][A-Z0-9]+)-\d+$/.test(valor)) return valor;
  return null;
}

function resolverVersion(input, versiones) {
  const numero = extraerNumeroVersion(input);
  if (!numero) {
    throw new Error(
      `No encontré un número de versión tipo x.x.x en "${input}".`,
    );
  }

  const inputNormalizado = normalizar(input);
  const candidatas = versiones.filter(
    (v) => extraerNumeroVersion(v.name) === numero,
  );

  const exacta = candidatas.find(
    (v) => normalizar(v.name) === inputNormalizado,
  );
  if (exacta) return exacta;

  const porPrefijo = candidatas.find((v) =>
    ["release", "releases"].includes(normalizar(v.name).split(" ")[0]),
  );
  if (porPrefijo) return porPrefijo;
  if (candidatas.length === 1) return candidatas[0];

  const disponibles = versiones
    .map((v) => v.name)
    .filter((name) => /release/i.test(name))
    .slice(-15)
    .join("\n  - ");

  throw new Error(
    `No existe la versión "${input}" en ${PROJECT_KEY}. No se crea nada.\n` +
      `Versiones recientes:\n  - ${disponibles}`,
  );
}

function parseArgs(argv) {
  const rest = [];
  let plan = null;
  let vincular = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--vincular-plan") {
      vincular = true;
      plan = argv[++i];
      continue;
    }
    if (arg === "--plan") {
      plan = argv[++i];
      continue;
    }
    if (arg.startsWith("--plan=")) {
      plan = arg.slice("--plan=".length);
      continue;
    }
    rest.push(arg);
  }

  return { rest, plan, vincular };
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

async function preguntarVersion(desdeArgs) {
  let input = desdeArgs;
  while (!extraerNumeroVersion(input)) {
    input = await preguntar("Número de release (ej. 4.11.1): ");
    if (!extraerNumeroVersion(input)) {
      console.log("Debe ser una versión tipo x.x.x.\n");
    }
  }
  return extraerNumeroVersion(input);
}

function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
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
  });
}

function extraerKeyTE(stdout) {
  const match = stdout.match(/Creado\s+(AVCD-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function obtenerVersiones() {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/project/${PROJECT_KEY}/versions`,
    { auth, headers },
  );
  return data;
}

async function obtenerIssue(key) {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/issue/${key}?fields=summary,issuetype,status`,
    { auth, headers },
  );
  return data;
}

async function transicionarA(issueKey, estadoDestino) {
  const destino = normalizarEstado(estadoDestino);
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/issue/${issueKey}/transitions`,
    { auth, headers },
  );
  const transicion = (data.transitions || []).find(
    (t) => normalizarEstado(t.to?.name) === destino,
  );
  if (!transicion) {
    const disponibles = (data.transitions || [])
      .map((t) => t.to?.name)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `No hay transición a "${estadoDestino}" desde ${issueKey}. Disponibles: ${disponibles || "ninguna"}`,
    );
  }

  await axios.post(
    `${JIRA_URL}/rest/api/3/issue/${issueKey}/transitions`,
    { transition: { id: transicion.id } },
    { auth, headers },
  );
}

async function autenticarXray() {
  if (!XRAY_CLIENT_ID || !XRAY_CLIENT_SECRET) {
    throw new Error(
      "Faltan XRAY_CLIENT_ID y XRAY_CLIENT_SECRET en jira-config.js.",
    );
  }

  const { data } = await axios.post(
    `${XRAY_BASE_URL}/api/v2/authenticate`,
    {
      client_id: XRAY_CLIENT_ID,
      client_secret: XRAY_CLIENT_SECRET,
    },
    { headers },
  );

  const token = typeof data === "string" ? data.replace(/^"|"$/g, "") : data;
  if (!token) throw new Error("Xray no devolvió un token de autenticación.");
  return token;
}

async function vincularTEsAlPlan(planKey, teKeys) {
  const plan = await obtenerIssue(planKey);
  const tipo = plan.fields?.issuetype?.name || "";
  if (tipo !== "Test Plan") {
    throw new Error(`${plan.key} es "${tipo}", no un Test Plan.`);
  }

  const tes = [];
  for (const key of teKeys) {
    const te = await obtenerIssue(key);
    if ((te.fields?.issuetype?.name || "") !== "Test Execution") {
      throw new Error(`${te.key} no es un Test Execution.`);
    }
    tes.push(te);
  }

  const token = await autenticarXray();
  const { data } = await axios.post(
    `${XRAY_BASE_URL}/api/v2/graphql`,
    {
      query: `
        mutation($issueId: String!, $testExecIssueIds: [String]!) {
          addTestExecutionsToTestPlan(
            issueId: $issueId
            testExecIssueIds: $testExecIssueIds
          ) {
            addedTestExecutions
            warning
          }
        }
      `,
      variables: {
        issueId: String(plan.id),
        testExecIssueIds: tes.map((t) => String(t.id)),
      },
    },
    {
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (data.errors?.length) {
    throw new Error(JSON.stringify(data.errors, null, 2));
  }

  const resultado = data.data.addTestExecutionsToTestPlan;
  if (resultado?.warning) console.log(`⚠️  Xray: ${resultado.warning}`);
  console.log(
    `✅ Asociadas ${tes.map((t) => t.key).join(", ")} a ${plan.key}`,
  );
  return plan;
}

async function modoVincular(planInput, teKeys) {
  const planKey = resolverKey(planInput);
  if (!planKey) {
    throw new Error(
      `El valor "${planInput}" no es un Test Plan válido. Ejemplo: 4447 o AVCD-4447`,
    );
  }
  if (teKeys.length < 2) {
    throw new Error("Faltan las keys de las dos Test Executions.");
  }
  await vincularTEsAlPlan(planKey, teKeys);
}

async function main() {
  if (!PROJECT_KEY) {
    throw new Error("Falta PROJECT_KEY en jira-config.js (ej. AVCD).");
  }

  const cli = parseArgs(process.argv.slice(2));

  if (cli.vincular) {
    await modoVincular(cli.plan, cli.rest);
    return;
  }

  const numero = await preguntarVersion(cli.rest[0]);

  console.log("🔎 Validando versión en Jira...");
  const versiones = await obtenerVersiones();
  const version = resolverVersion(numero, versiones);
  console.log(`📌 Versión corregida: ${version.name}\n`);

  console.log(`🚀 Humo completo ${numero}\n`);
  const smoke = await runNode(SMOKE_JS, [numero]);
  const smokeKey = extraerKeyTE(smoke.stdout);
  if (!smokeKey) {
    throw new Error(
      "No encontré la key del TE de humo (AVCD-####). No creo la regresión.",
    );
  }
  console.log(`📌 Humo: ${smokeKey} (Por hacer)\n`);

  console.log(`🚀 Regresión manual ${numero}\n`);
  const regression = await runNode(REGRESSION_JS, [numero]);
  const regressionKey = extraerKeyTE(regression.stdout);
  if (!regressionKey) {
    throw new Error("No encontré la key del TE de regresión (AVCD-####).");
  }

  console.log(`🔄 Pasando ${regressionKey} a ${ESTADO_EN_PRUEBAS}...`);
  await transicionarA(regressionKey, ESTADO_EN_PRUEBAS);
  console.log(`📌 Regresión: ${regressionKey} (${ESTADO_EN_PRUEBAS})\n`);

  if (cli.plan) {
    const planKey = resolverKey(cli.plan);
    if (!planKey) {
      throw new Error(
        `El valor "${cli.plan}" no es un Test Plan válido. Ejemplo: 4447`,
      );
    }
    await vincularTEsAlPlan(planKey, [smokeKey, regressionKey]);
  }

  console.log(`\n✅ Humo + regresión ${numero}`);
  console.log(`   Humo:      ${smokeKey}  (Por hacer)`);
  console.log(`   Regresión: ${regressionKey}  (${ESTADO_EN_PRUEBAS})`);
}

main().catch((error) => {
  const detalle = error.response?.data || error.message || error;
  console.error("❌", typeof detalle === "string" ? detalle : JSON.stringify(detalle));
  process.exitCode = 1;
});
