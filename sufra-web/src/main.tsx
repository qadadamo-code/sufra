import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "blobatar/motion.css";
import "./styles/index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
