"use client";

import type { ButtonHTMLAttributes } from "react";
import { buttonClassName, type ButtonSize, type ButtonStyleProps, type ButtonTone, type ButtonVariant } from "@/components/ui/button-styles";

export type { ButtonSize, ButtonTone, ButtonVariant };
export { buttonClassName };

type Props = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleProps;

export function Button({ variant = "primary", tone = "ember", size = "md", className, type = "button", ...props }: Props) {
  return <button type={type} className={buttonClassName({ variant, tone, size, className })} {...props} />;
}
