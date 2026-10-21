const { createApp } = require("./api/app.cjs");
const app = createApp();
const server = app.listen(process.env.PORT || 3000, "0.0.0.0", () =>
  console.log(
    "Sanji server started. Private workspace: /app/. Real sending defaults to OFF.",
  ),
);
process.on("SIGTERM", () =>
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  }),
);
