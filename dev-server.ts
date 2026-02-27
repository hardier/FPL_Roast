import app from "./api/index.ts";
import { createServer as createViteServer } from "vite";

const PORT = process.env.PORT || 3000;

async function startDevServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  app.use(vite.middlewares);

  app.listen(PORT, () => {
    console.log(`Dev server running on http://localhost:${PORT}`);
  });
}

startDevServer();
