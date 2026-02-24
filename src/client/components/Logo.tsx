import type { ImgHTMLAttributes } from "react";
import { useTheme } from "../context/ThemeContext.js";

type LogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export function Logo({ alt = "Peckmail", ...props }: LogoProps) {
  const { resolvedTheme } = useTheme();
  const src =
    resolvedTheme === "dark" ? "/assets/logo-dark.png" : "/assets/logo.png";

  return <img src={src} alt={alt} {...props} />;
}
