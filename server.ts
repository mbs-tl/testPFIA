import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Initialize Gemini SDK with custom user-agent for telemetry
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// API endpoint for Google Sheet Import (bypasses CORS)
app.post("/api/import-sheet", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).json({ error: "L'URL du Google Sheet est requise." });
      return;
    }

    // Extract spreadsheet ID and convert to CSV export URL
    // Format: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit...
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      res.status(400).json({ error: "L'URL fournie ne semble pas être une URL de Google Sheet valide." });
      return;
    }

    const spreadsheetId = match[1];
    
    // Extract grid ID (gid) if present
    const gidMatch = url.match(/[#&]gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";
    
    const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gidParam}`;

    console.log(`Fetching Google Sheet CSV from: ${exportUrl}`);
    const response = await fetch(exportUrl);
    
    if (!response.ok) {
      res.status(400).json({ 
        error: "Impossible d'importer le Google Sheet. Assurez-vous qu'il est partagé en mode 'Lecteur public' (Anyone with the link can view)." 
      });
      return;
    }

    const csvText = await response.text();
    
    // Custom CSV Parser that handles quotes and commas correctly
    const parseCSV = (text: string): string[][] => {
      const lines: string[][] = [];
      let row: string[] = [];
      let inQuotes = false;
      let current = "";
      
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === "," && !inQuotes) {
          row.push(current.trim());
          current = "";
        } else if ((char === "\r" || char === "\n") && !inQuotes) {
          if (char === "\r" && nextChar === "\n") i++;
          row.push(current.trim());
          lines.push(row);
          row = [];
          current = "";
        } else {
          current += char;
        }
      }
      
      if (current || row.length > 0) {
        row.push(current.trim());
        lines.push(row);
      }
      
      return lines.filter(r => r.length > 0 && r.some(cell => cell !== ""));
    };

    const parsedData = parseCSV(csvText);
    res.json({ data: parsedData });
  } catch (error: any) {
    console.error("Error importing Google Sheet:", error);
    res.status(500).json({ error: `Erreur d'importation: ${error.message || error}` });
  }
});

// API endpoint for Dynamic AI Analysis using Gemini
app.post("/api/analyze", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { mode, dataSummary } = req.body;

    if (!dataSummary) {
      res.status(400).json({ error: "Les données d'analyse sont requises." });
      return;
    }

    let prompt = "";

    if (mode === "detection-ia") {
      prompt = `Tu es un expert analyste de données spécialisé dans l'évaluation de tests psychologiques et d'interactions avec l'IA.
Analyse les résultats suivants du test de "Détection d'images IA vs Réelles" :
${JSON.stringify(dataSummary, null, 2)}

Rédige un rapport d'analyse synthétique, extrêmement professionnel et captivant en français.
Structure ta réponse au format JSON pour que nous puissions l'afficher joliment dans notre application avec les champs suivants :
{
  "performanceSummary": "Une synthèse générale de 2-3 phrases sur les performances globales des participants, leur capacité à repérer l'IA et l'impact général des suggestions.",
  "strengths": [
    "Point fort 1 sur les comportements des testeurs (ex: très perspicaces sur le type Réel, etc.)",
    "Point fort 2 (ex: temps de réaction ou amélioration de confiance)"
  ],
  "vulnerabilities": [
    "Vulnérabilité 1 (ex: l'IA arrive facilement à les tromper sur les images de type X, etc.)",
    "Vulnérabilité 2 (ex: baisse de confiance finale injustifiée)"
  ],
  "confidenceAnalysis": "Une analyse du niveau de confiance initial vs final. Les participants sont-ils trop confiants, hésitants, ou l'aide de l'IA a-t-elle amélioré ou détérioré leur certitude ?",
  "recommendations": [
    "Conseil d'entraînement ou amélioration 1",
    "Conseil d'entraînement ou amélioration 2"
  ]
}

Assure-toi de retourner STRICTEMENT l'objet JSON, sans markdown additionnel ou blocs de code.`;
    } else {
      prompt = `Tu es un expert scientifique en analyse de données temporelles.
Analyse les mesures récoltées au cours de cette série temporelle :
${JSON.stringify(dataSummary, null, 2)}

Rédige un rapport d'analyse de tendance et d'anomalies en français.
Structure ta réponse au format JSON avec les champs suivants :
{
  "performanceSummary": "Une synthèse générale de 2-3 phrases sur la tendance générale des mesures, la stabilité temporelle et les observations clés.",
  "strengths": [
    "Caractéristique positive 1 de la série temporelle (ex: croissance stable, faible volatilité sur telle période)",
    "Caractéristique positive 2"
  ],
  "vulnerabilities": [
    "Anomalie ou point d'attention 1 (ex: pics inhabituels, baisses brutales détectées)",
    "Anomalie ou point d'attention 2"
  ],
  "confidenceAnalysis": "Analyse de la tendance et de la régression. Est-ce que les données se stabilisent, s'accélèrent ou oscillent de manière cyclique ?",
  "recommendations": [
    "Action recommandée 1 basée sur ces mesures",
    "Action recommandée 2 pour le suivi des tests"
  ]
}

Assure-toi de retourner STRICTEMENT l'objet JSON, sans markdown additionnel ou blocs de code.`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Aucune analyse générée.");
    }

    const resultJson = JSON.parse(text.trim());
    res.json(resultJson);
  } catch (error: any) {
    console.error("Gemini Analysis Error:", error);
    res.status(500).json({ error: `Erreur d'analyse par l'IA: ${error.message || error}` });
  }
});

// Serve Frontend using Vite in Dev or Static files in Prod
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
