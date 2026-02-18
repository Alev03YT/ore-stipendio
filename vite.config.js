import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);
export default defineConfig({
  base: "/ore-stipendio/",
  plugins: [react()],
});
