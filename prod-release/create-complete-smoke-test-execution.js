const fs = require("fs");
const path = require("path");
const readline = require("readline");
const axios = require("axios");

// npm run smoke:complete -- "Release 4.12.0"

const {
  JIRA_URL,
  EMAIL,
  API_TOKEN,
  PROJECT_KEY,
  XRAY_CLIENT_ID,
  XRAY_CLIENT_SECRET,
  XRAY_BASE_URL = "https://xray.cloud.getxray.app",
} = require("../jira-config");

const ASSIGNEE_QUERY = "diegoan.garcia";
const TEST_SET_KEY = "AVCD-2387";
const TEST_SET_FIJO_KEY = "AVCD-4346";
const DICCIONARIO_PATH = path.join(__dirname, "funcionalidades.json");
const TIPOS_HISTORIA = ["Historia", "Story", "Tech Story"];

const auth = {
  username: EMAIL,
  password: API_TOKEN,
};

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

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

async function preguntarVersion() {
  const desdeArgs = process.argv.slice(2).join(" ").trim();
  if (desdeArgs) return desdeArgs;
  return preguntar("Versión corregida (ej. Release 3.11.1): ");
}

function extraerNumeroVersion(texto) {
  const match = texto.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function normalizar(texto) {
  return texto.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contienePalabra(texto, keyword) {
  const haystack = ` ${normalizarTexto(texto)} `;
  const needle = normalizarTexto(keyword);
  if (!needle) return false;
  return haystack.includes(` ${needle} `);
}

function resolverVersion(input, versiones) {
  const numero = extraerNumeroVersion(input);
  if (!numero) {
    throw new Error(
      `No encontré un número de versión tipo x.x.x en "${input}". Ejemplo válido: Release 3.11.1`,
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
    `No existe la versión "${input}" en ${PROJECT_KEY}.\n` +
      `Versiones recientes:\n  - ${disponibles}`,
  );
}

function textoADF(texto) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: texto }],
      },
    ],
  };
}

function cargarDiccionario() {
  if (!fs.existsSync(DICCIONARIO_PATH)) {
    throw new Error(`No encontré el diccionario: ${DICCIONARIO_PATH}`);
  }

  const raw = JSON.parse(fs.readFileSync(DICCIONARIO_PATH, "utf-8"));
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error(
      "funcionalidades.json está vacío. Agrega al menos una funcionalidad.",
    );
  }

  return raw.map((item, index) => {
    const historia = (item.historia || []).filter(Boolean);
    const test = (item.test || []).filter(Boolean);
    if (!historia.length || !test.length) {
      throw new Error(
        `La funcionalidad #${index + 1} (${item.id || "sin id"}) necesita arrays "historia" y "test".`,
      );
    }
    return {
      id: item.id || `funcionalidad-${index + 1}`,
      nombre: item.nombre || item.id || `funcionalidad-${index + 1}`,
      historia,
      test,
    };
  });
}

function detectarFuncionalidades(historias, diccionario) {
  return diccionario.filter((func) =>
    historias.some((h) =>
      func.historia.some((palabra) =>
        contienePalabra(h.fields.summary, palabra),
      ),
    ),
  );
}

function filtrarTests(tests, funcionalidades) {
  if (!funcionalidades.length) return [];

  return tests.filter((t) =>
    funcionalidades.some((func) =>
      func.test.some((palabra) => contienePalabra(t.fields.summary, palabra)),
    ),
  );
}

function funcionalidadesDeHistoria(historia, diccionario) {
  return diccionario.filter((func) =>
    func.historia.some((palabra) =>
      contienePalabra(historia.fields.summary, palabra),
    ),
  );
}

function testsFijosSinDuplicados(testsFijos, testsYaAsociados) {
  const keys = new Set(testsYaAsociados.map((t) => t.key));
  return {
    nuevos: testsFijos.filter((t) => !keys.has(t.key)),
    duplicados: testsFijos.filter((t) => keys.has(t.key)),
  };
}

function reportarTestsFijos(testsFijos, resultado) {
  console.log(
    `📦 Test Set fijo ${TEST_SET_FIJO_KEY}: ${testsFijos.length} casos`,
  );
  console.log(`   + ${resultado.nuevos.length} se agregan siempre`);
  resultado.nuevos.forEach((t) => {
    console.log(`     - ${t.key}: ${t.fields.summary}`);
  });
  if (resultado.duplicados.length) {
    console.log(
      `   ↷ ${resultado.duplicados.length} omitidos por ya estar en el filtro de ${TEST_SET_KEY}:`,
    );
    resultado.duplicados.forEach((t) => {
      console.log(`     - ${t.key}: ${t.fields.summary}`);
    });
  }
}

function historiasSinCaso(historias, diccionario, testsDelSet) {
  return historias
    .map((historia) => {
      const funcs = funcionalidadesDeHistoria(historia, diccionario);
      const tests = filtrarTests(testsDelSet, funcs);
      if (tests.length) return null;

      return {
        historia,
        motivo: funcs.length
          ? `se detectó ${funcs.map((f) => f.nombre).join(", ")}, pero no hay casos en ${TEST_SET_KEY}`
          : "el título no coincide con ninguna funcionalidad del diccionario",
      };
    })
    .filter(Boolean);
}

async function buscarIssues(jql) {
  const issues = [];
  let nextPageToken;

  do {
    const payload = {
      jql,
      fields: ["summary", "key", "issuetype"],
      maxResults: 100,
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;

    const { data } = await axios.post(
      `${JIRA_URL}/rest/api/3/search/jql`,
      payload,
      { auth, headers },
    );

    issues.push(...(data.issues || []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  return issues;
}

async function obtenerVersiones() {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/project/${PROJECT_KEY}/versions`,
    { auth, headers },
  );
  return data;
}

async function obtenerHistoriasDeVersion(versionName) {
  const tipos = TIPOS_HISTORIA.map((t) => `"${t}"`).join(", ");
  return buscarIssues(
    `project = ${PROJECT_KEY} AND fixVersion = "${versionName}" AND issuetype in (${tipos}) ORDER BY key ASC`,
  );
}

async function obtenerTestsDelSet(testSetKey) {
  return buscarIssues(`issue in testSetTests(${testSetKey})`);
}

async function obtenerAsignado() {
  const { data } = await axios.get(`${JIRA_URL}/rest/api/3/user/search`, {
    auth,
    headers,
    params: { query: ASSIGNEE_QUERY },
  });

  const usuario = (data || []).find(
    (u) =>
      u.displayName === ASSIGNEE_QUERY ||
      (u.emailAddress || "").toLowerCase().startsWith(`${ASSIGNEE_QUERY}@`),
  ) || data?.[0];

  if (!usuario?.accountId) {
    throw new Error(`No encontré el usuario "${ASSIGNEE_QUERY}" en Jira.`);
  }

  return usuario;
}

async function crearTestExecution(summary, description, version, accountId) {
  const { data } = await axios.post(
    `${JIRA_URL}/rest/api/3/issue`,
    {
      fields: {
        project: { key: PROJECT_KEY },
        issuetype: { name: "Test Execution" },
        summary,
        description: textoADF(description),
        fixVersions: [{ name: version.name }],
        assignee: { accountId },
      },
    },
    { auth, headers },
  );

  return data;
}

async function autenticarXray() {
  if (!XRAY_CLIENT_ID || !XRAY_CLIENT_SECRET) {
    throw new Error(
      "Faltan XRAY_CLIENT_ID y XRAY_CLIENT_SECRET en jira-config.js.\n" +
        "Créalos en Jira: Apps → Xray → API Keys.",
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
  if (!token) {
    throw new Error("Xray no devolvió un token de autenticación.");
  }
  return token;
}

async function xrayGraphql(token, query, variables) {
  const { data } = await axios.post(
    `${XRAY_BASE_URL}/api/v2/graphql`,
    { query, variables },
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

  return data.data;
}

async function agregarTestsAlExecution(token, executionId, testIds) {
  const BATCH = 50;
  let added = 0;

  for (let i = 0; i < testIds.length; i += BATCH) {
    const batch = testIds.slice(i, i + BATCH);
    const data = await xrayGraphql(
      token,
      `
        mutation($issueId: String!, $testIssueIds: [String]!) {
          addTestsToTestExecution(
            issueId: $issueId
            testIssueIds: $testIssueIds
          ) {
            addedTests
            warning
          }
        }
      `,
      {
        issueId: String(executionId),
        testIssueIds: batch.map(String),
      },
    );

    const resultado = data.addTestsToTestExecution;
    if (resultado?.warning) {
      console.log(`⚠️  Xray: ${resultado.warning}`);
    }
    added += resultado?.addedTests?.length || batch.length;
  }

  return added;
}

function reportarHistoriasSinCaso(sinCaso) {
  if (!sinCaso.length) {
    console.log(
      "🟢 Todas las historias tienen al menos un caso aplicable en el Test Set.",
    );
    return;
  }

  console.log(`⚠️  ${sinCaso.length} historia(s) sin caso aplicable:`);
  sinCaso.forEach(({ historia, motivo }) => {
    console.log(`   - ${historia.key}: ${historia.fields.summary}`);
    console.log(`     ${motivo}`);
  });
}

function reportarMatching(historias, funcionalidades, tests) {
  console.log(`📖 ${historias.length} historias en la publicación:`);
  historias.forEach((h) => {
    console.log(`   - ${h.key}: ${h.fields.summary}`);
  });

  if (!funcionalidades.length) {
    console.log(
      "⚠️  Ninguna funcionalidad del diccionario coincidió con los títulos.",
    );
    return;
  }

  console.log(
    `🎯 Funcionalidades detectadas: ${funcionalidades
      .map((f) => f.nombre)
      .join(", ")}`,
  );
  console.log(`📋 ${tests.length} casos del Test Set que aplican:`);
  tests.forEach((t) => {
    console.log(`   - ${t.key}: ${t.fields.summary}`);
  });
}

async function main() {
  try {
    if (!PROJECT_KEY) {
      throw new Error("Falta PROJECT_KEY en jira-config.js (ej. AVCD).");
    }

    const input = await preguntarVersion();
    if (!input) {
      throw new Error("Debes indicar la versión, por ejemplo: Release 3.11.1");
    }

    const diccionario = cargarDiccionario();

    console.log("🔑 Autenticando en Xray...");
    const xrayToken = await autenticarXray();

    console.log("🔎 Buscando versión en Jira...");
    const versiones = await obtenerVersiones();
    const version = resolverVersion(input, versiones);
    const numero = extraerNumeroVersion(version.name);
    const summary = `Pruebas de Humo - Release ${numero}`;
    const description = `Pruebas de humo Release ${numero}`;

    console.log(`📌 Versión corregida: ${version.name}`);
    console.log(`📦 Test Set filtro: ${TEST_SET_KEY}`);
    console.log(`📦 Test Set fijo: ${TEST_SET_FIJO_KEY}`);
    console.log(`📚 Diccionario: ${diccionario.length} funcionalidades`);

    const [historias, testsDelSet, testsFijos, usuario] = await Promise.all([
      obtenerHistoriasDeVersion(version.name),
      obtenerTestsDelSet(TEST_SET_KEY),
      obtenerTestsDelSet(TEST_SET_FIJO_KEY),
      obtenerAsignado(),
    ]);

    if (!historias.length) {
      throw new Error(
        `No encontré historias en ${version.name}. Revisa fixVersion e issuetype (Historia, Story, Tech Story).`,
      );
    }

    if (!testsDelSet.length) {
      throw new Error(`El Test Set ${TEST_SET_KEY} no tiene casos de prueba.`);
    }

    if (!testsFijos.length) {
      throw new Error(
        `El Test Set fijo ${TEST_SET_FIJO_KEY} no tiene casos de prueba.`,
      );
    }

    const funcionalidades = detectarFuncionalidades(historias, diccionario);
    const tests = filtrarTests(testsDelSet, funcionalidades);
    const fijos = testsFijosSinDuplicados(testsFijos, tests);
    const sinCaso = historiasSinCaso(historias, diccionario, testsDelSet);
    reportarMatching(historias, funcionalidades, tests);
    reportarTestsFijos(testsFijos, fijos);

    console.log(`📝 Summary: ${summary}`);
    console.log(`📄 Descripción: ${description}`);
    console.log(`👤 Persona asignada: ${usuario.displayName} (${usuario.emailAddress})`);
    console.log("🚀 Creando Test Execution...");

    const issue = await crearTestExecution(
      summary,
      description,
      version,
      usuario.accountId,
    );
    const url = `${JIRA_URL}/browse/${issue.key}`;

    if (tests.length) {
      console.log(`🔗 Asociando ${tests.length} casos filtrados de ${TEST_SET_KEY}...`);
      await agregarTestsAlExecution(
        xrayToken,
        issue.id,
        tests.map((t) => t.id),
      );
    } else {
      console.log(
        `⚠️  Ningún caso de ${TEST_SET_KEY} aplicó a la publicación.`,
      );
    }

    if (fijos.nuevos.length) {
      console.log(
        `🔗 Asociando ${fijos.nuevos.length} casos fijos de ${TEST_SET_FIJO_KEY}...`,
      );
      await agregarTestsAlExecution(
        xrayToken,
        issue.id,
        fijos.nuevos.map((t) => t.id),
      );
    }

    const total = tests.length + fijos.nuevos.length;
    console.log(`✅ Creado ${issue.key} con ${total} casos`);
    console.log(`🔗 ${url}`);
    reportarHistoriasSinCaso(sinCaso);
  } catch (error) {
    const detalle = error.response?.data || error.message;
    console.log("❌ Error:", detalle);
    process.exitCode = 1;
  }
}

main();
