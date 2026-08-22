// Shared across every tool page: the Radix color scales plus the dark-mode
// wiring. Radix dark scales live under `.dark`, so mirror the OS preference
// onto <html> instead of relying on a media query in our own CSS.
import "@radix-ui/colors/slate.css";
import "@radix-ui/colors/slate-dark.css";
import "@radix-ui/colors/indigo.css";
import "@radix-ui/colors/indigo-dark.css";
import "@radix-ui/colors/red.css";
import "@radix-ui/colors/red-dark.css";

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches);
applyTheme();
darkQuery.addEventListener("change", applyTheme);
