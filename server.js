import http from "node:http";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const MAX_BODY = 50 * 1024 * 1024;

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
  });
  res.end(body);
}

async function analyze(frames, context) {
  const content = [{
    type: "input_text",
    text: [
      "Analisa estes frames de um jogo de futebol em sequência temporal.",
      "Encontra momentos que mereçam um highlight.",
      "Procura sobretudo: golos da equipa da casa, golos adversários, defesas importantes, grandes oportunidades e lances claramente destacados.",
      "Usa os timestamps enviados para localizar o momento.",
      "Não inventes acontecimentos que não sejam visualmente sustentados pelos frames.",
      "Se a evidência for fraca, não cries evento.",
      "É permitido devolver zero eventos.",
      `Contexto: ${JSON.stringify(context || {})}`
    ].join("\n")
  }];

  for (const f of frames.slice(0, 18)) {
    content.push({
      type: "input_text",
      text: `FRAME — timestamp ${Number(f.time).toFixed(2)} segundos`
    });
    content.push({
      type: "input_image",
      image_url: f.image,
      detail: "low"
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "football_highlight_events",
          strict: true,
          schema: {
            type: "object",
            properties: {
              events: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    time: { type: "number" },
                    type: {
                      type: "string",
                      enum: [
                        "goal_home",
                        "goal_away",
                        "save",
                        "chance",
                        "highlight"
                      ]
                    },
                    confidence: { type: "number" },
                    reason: { type: "string" }
                  },
                  required: [
                    "time",
                    "type",
                    "confidence",
                    "reason"
                  ],
                  additionalProperties: false
                }
              }
            },
            required: ["events"],
            additionalProperties: false
          }
        }
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `OpenAI HTTP ${response.status}`
    );
  }

  let result = { events: [] };

  try {
    result = JSON.parse(
      data.output_text || '{"events":[]}'
    );
  } catch {
    throw new Error("A IA devolveu uma resposta inválida.");
  }

  return {
    events: Array.isArray(result.events)
      ? result.events
          .map(e => ({
            time: Number(e.time),
            type: e.type,
            confidence: Math.max(
              0,
              Math.min(1, Number(e.confidence))
            ),
            reason: String(e.reason || "")
          }))
          .filter(
            e =>
              Number.isFinite(e.time) &&
              Number.isFinite(e.confidence)
          )
      : []
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/") {
    return send(res, 200, {
      service: "Football Highlights Maduro Studio AI",
      status: "online",
      model: MODEL
    });
  }

  if (req.method === "POST" && req.url === "/analyze") {
    if (!process.env.OPENAI_API_KEY) {
      return send(res, 500, {
        error: "OPENAI_API_KEY não configurada no servidor."
      });
    }

    let raw = "";

    try {
      for await (const chunk of req) {
        raw += chunk;

        if (Buffer.byteLength(raw, "utf8") > MAX_BODY) {
          return send(res, 413, {
            error: "Pedido demasiado grande."
          });
        }
      }

      const body = JSON.parse(raw || "{}");

      const frames = Array.isArray(body.frames)
        ? body.frames
            .filter(
              f =>
                f &&
                typeof f.image === "string" &&
                Number.isFinite(Number(f.time))
            )
            .slice(0, 18)
        : [];

      if (!frames.length) {
        return send(res, 400, {
          error: "É necessário enviar pelo menos um frame válido."
        });
      }

      const result = await analyze(
        frames,
        body.context || {}
      );

      return send(res, 200, result);

    } catch (err) {
      console.error(err);

      return send(res, 500, {
        error:
          err?.message ||
          "Erro interno no backend de IA."
      });
    }
  }

  send(res, 404, {
    error: "Rota não encontrada."
  });
});

server.listen(PORT, () => {
  console.log(
    `Football Highlights Maduro Studio AI listening on ${PORT}`
  );
});
