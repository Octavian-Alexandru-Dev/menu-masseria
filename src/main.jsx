import React from "react";
import ReactDOM from "react-dom/client";
import MenuApp from "./MenuApp.jsx";
import { initDisplayZoom } from "./displayZoom";

// The zoom saved on this device (phones/tablets), before the first render.
initDisplayZoom();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MenuApp />
  </React.StrictMode>
);
