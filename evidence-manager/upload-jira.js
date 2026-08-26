const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");

// ✅ CONFIG EXTERNO
const {
  JIRA_URL,
  ISSUE_KEY,
  EMAIL,
  API_TOKEN,
  FOLDER_PATH
} = require("../jira-config");

const auth = {
  username: EMAIL,
  password: API_TOKEN,
};

// =====================
// LIMPIAR NOMBRE (como ya usabas)
// =====================
function limpiarNombre(nombre) {
  nombre = nombre.replace(/\.(mp4|webm|mov|n)$/gi, "");
  nombre = nombre.replace(/_\d{4}-\d{2}-\d{2}/g, "");
  nombre = nombre.replace(/\s\d{4}-\d{2}-\d{2}/g, "");
  nombre = nombre.replace(/-/g, " ");
  nombre = nombre.replace(/^[•|\s]+/, "");
  nombre = nombre.replace(/\s+/g, " ").trim();

  return nombre;
}

// =====================
// LEER ARCHIVOS
// =====================
const files = fs.readdirSync(FOLDER_PATH)
  .filter(file => !file.startsWith("."));

// =====================
// SUBIR ARCHIVOS + GENERAR DATOS
// =====================
async function subirYProcesar() {
  console.log("Subiendo archivos...");

  const datos = [];

  for (const file of files) {
    const filePath = path.join(FOLDER_PATH, file);

    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));

    try {
      const response = await axios.post(
        `${JIRA_URL}/rest/api/3/issue/${ISSUE_KEY}/attachments`,
        form,
        {
          auth,
          headers: {
            ...form.getHeaders(),
            "X-Atlassian-Token": "no-check",
          },
        }
      );

      const att = response.data[0];

      datos.push({
        caso: limpiarNombre(file), // ✅ nombre desde archivo
        evidencia: att.content     // ✅ link del archivo
      });

      console.log(`✅ Subido: ${file}`);

    } catch (error) {
      console.log(`❌ Error: ${file}`, error.response?.data);
    }
  }

  // ✅ ORDEN ALFABÉTICO
  datos.sort((a, b) =>
    a.caso.localeCompare(b.caso, "es", { sensitivity: "base" })
  );

  return datos;
}

// =====================
// TABLA ADF
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
                content: [{
                  type: "paragraph",
                  content: [{ type: "text", text: "Caso De Prueba" }]
                }]
              },
              {
                type: "tableHeader",
                content: [{
                  type: "paragraph",
                  content: [{ type: "text", text: "Evidencia" }]
                }]
              }
            ]
          },

          // FILAS
          ...datos.map(d => ({
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{
                  type: "paragraph",
                  content: [{ type: "text", text: d.caso }]
                }]
              },
              {
                type: "tableCell",
                content: [{
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Ver archivo",
                      marks: [{
                        type: "link",
                        attrs: { href: d.evidencia }
                      }]
                    }
                  ]
                }]
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
async function crearComentario(datos) {
  const bodyADF = crearTablaADF(datos);

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
      }
    );

    console.log("✅ Comentario creado con archivos como casos 🚀");

  } catch (error) {
    console.log("❌ Error creando comentario", error.response?.data);
  }
}

// =====================
// MAIN
// =====================
async function main() {
  const datos = await subirYProcesar();
  await crearComentario(datos);
}

main();