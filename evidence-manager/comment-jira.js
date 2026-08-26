const fs = require("fs");
const path = require("path");
const axios = require("axios");

// IMPORTAR CONFIG
const {
  JIRA_URL,
  ISSUE_KEY,
  EMAIL,
  API_TOKEN,
  FOLDER_PATH,
} = require("../jira-config");

// =====================
const auth = {
  username: EMAIL,
  password: API_TOKEN,
};

// =====================
// LIMPIEZA
// =====================
function limpiarNombre(nombre) {
  nombre = nombre.replace(/\.(mp4|webm|mov|n)$/gi, "");

  const palabrasIgnoradas = ["chromium", "firefox", "webkit", "edge", "safari"];

  const regexIgnoradas = new RegExp(
    `(?:_|-|\\s)?(${palabrasIgnoradas.join("|")})(?=_|\\s|-|$)`,
    "gi",
  );

  nombre = nombre.replace(regexIgnoradas, "");
  nombre = nombre.replace(/_\d{4}-\d{2}-\d{2}/g, "");
  nombre = nombre.replace(/\s\d{4}-\d{2}-\d{2}/g, "");
  nombre = nombre.replace(/-/g, " ");
  nombre = nombre.replace(/^[•|\s]+/, "");
  nombre = nombre.replace(/\s+/g, " ").trim();

  const correcciones = {
    ceunta: "cuenta",
    psgo: "pago",
    impuestp: "impuesto",
    hipotecarios: "hipotecario",
    debloqueo: "desbloqueo",
    hipotecarioo: "hipotecario",
  };

  Object.entries(correcciones).forEach(([err, fix]) => {
    nombre = nombre.replace(new RegExp(`\\b${err}\\b`, "gi"), fix);
  });

  const tildes = {
    credito: "crédito",
    historico: "histórico",
    contrasena: "contraseña",
    debito: "débito",
    biometria: "biometría",
    personalizacion: "personalización",
  };

  Object.entries(tildes).forEach(([k, v]) => {
    nombre = nombre.replace(new RegExp(`\\b${k}\\b`, "gi"), v);
  });

  nombre = nombre
    .toLowerCase()
    .split(" ")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

  const siglas = [
    "TC",
    "TCV",
    "TDD",
    "CDT",
    "AFC",
    "PSE",
    "AVAL",
    "PAY",
    "QR",
    "TRX",
    "MFE",
    "SF",
  ];

  siglas.forEach((sigla) => {
    nombre = nombre.replace(new RegExp(`\\b${sigla}\\b`, "gi"), sigla);
  });

  nombre = nombre.replace(/Bre B/gi, "Bre B");
  nombre = nombre.replace(/No Aval/gi, "No AVAL");
  nombre = nombre.replace(/Avalpay/gi, "AVAL PAY");

  return nombre;
}

// =====================
// PROCESAMIENTO + ORDEN
// =====================
function procesarArchivos() {
  const files = fs.readdirSync(FOLDER_PATH).filter((f) => !f.startsWith("."));

  const resultados = [];

  files.forEach((file) => {
    const partes = file.split(/(?=\.mp4|\.webm|\.mov)/gi);

    partes.forEach((p) => {
      const limpio = limpiarNombre(p);
      if (limpio) resultados.push(limpio);
    });
  });

  // ✅ ORDEN ALFABÉTICO (ESPAÑOL)
  resultados.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  return resultados;
}

// =====================
// ✅ TABLA ADF (2 COLUMNAS)
// =====================
function crearTablaADF(datos) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "table",
        attrs: { layout: "default" },
        content: [
          // HEADER
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Caso De Prueba" }],
                  },
                ],
              },
              {
                type: "tableHeader",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Evidencia" }],
                  },
                ],
              },
            ],
          },

          // FILAS
          ...datos.map((d) => ({
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: d }],
                  },
                ],
              },
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [], // columna evidencia vacía
                  },
                ],
              },
            ],
          })),
        ],
      },
    ],
  };
}

// =====================
// CREAR COMENTARIO
// =====================
async function crearComentario(bodyADF) {
  try {
    await axios.post(
      `${JIRA_URL}/rest/api/3/issue/${ISSUE_KEY}/comment`,
      { body: bodyADF },
      {
        auth,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      },
    );

    console.log("✅ Comentario creado correctamente 🚀");
  } catch (error) {
    console.log("❌ Error:", error.response?.data);
  }
}

// =====================
// MAIN
// =====================
async function main() {
  const datos = procesarArchivos();
  const tablaADF = crearTablaADF(datos);
  await crearComentario(tablaADF);
}

main();
