import React from "react"
import { Icon } from "./Icon"

interface NovaCodeIconProps {
  size?: string
}

export function NovaCodeIcon({ size = "1.2em" }: NovaCodeIconProps) {
  return <Icon src="/docs/img/kilo-v1.svg" srcDark="/docs/img/kilo-v1-white.svg" alt="Nova Code Icon" size={size} />
}
