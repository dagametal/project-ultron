const fs = require("fs");
const axios = require("axios");
const readline = require("readline");

// ✅ CONFIG
const {
  JIRA_URL,
  ISSUE_KEY,
  EMAIL,
  API_TOKEN
} = require("./jira-config");

const FILE_PATH = "./casos.txt";

const auth = {
  username: EMAIL,
  password: API_TOKEN,
};

// =====================
// PREGUNTA INTERACTIVA
// =====================
function preguntarOrden() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question("¿Deseas ordenar alfabéticamente? (s/n): ", (respuesta) => {
      rl.close();
      resolve(respuesta.toLowerCase().startsWith("s"));
    });
  });
}

// =====================
// PROCESAR TXT
// =====================
function procesarTxt(ordenar) {
  const raw = fs.readFileSync(FILE_PATH, "utf-8");

  const lineas = raw.split("\n");

  const resultados = [];

  lineas.forEach(linea => {
    const limpio = linea.trim();

    if (limpio) {
      resultados.push(limpio);
    }
  });

  // ✅ ordenar SOLO si el usuario lo pidió
  if (ordenar) {
    resultados.sort((a, b) =>
      a.localeCompare(b, "es", { sensitivity: "base" })
    );
  }

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
                    content: [
                      { type: "text", text: "Caso De Prueba" }
                    ]
                  }
                ]
              },
              {
                type: "tableHeader",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Evidencia" }
                    ]
                  }
                ]
              }
            ]
          },

          // FILAS
          ...datos.map(d => ({
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: d }]
                  }
                ]
              },
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [] // columna evidencia vacía
                  }
                ]
              }
            ]
          }))
        ]
      }
    ]
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
          "Content-Type": "application/json"
        }
      }
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

  const ordenar = await preguntarOrden();

  console.log(
    ordenar
      ? "📊 Ordenando alfabéticamente..."
      : "📄 Manteniendo orden original..."
  );

  const datos = procesarTxt(ordenar);
  const tablaADF = crearTablaADF(datos);
  await crearComentario(tablaADF);
}

main();