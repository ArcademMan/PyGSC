/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";

document.addEventListener("contextmenu", (e) => e.preventDefault());

render(() => <App />, document.getElementById("root") as HTMLElement);
