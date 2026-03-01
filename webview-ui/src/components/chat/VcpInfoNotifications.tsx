import React, { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Bell, Info, XCircle } from "lucide-react"

import { cn } from "@src/lib/utils"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Button, Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@src/components/ui"

interface VcpInfoNotificationsProps {
	className?: string
}

const formatTime = (timestamp: number) => {
	try {
		return new Date(timestamp).toLocaleTimeString()
	} catch {
		return "--:--:--"
	}
}

export const VcpInfoNotifications: React.FC<VcpInfoNotificationsProps> = ({ className }) => {
	const { vcpConfig, vcpBridgeLogEntries } = useExtensionState()
	const [open, setOpen] = useState(false)
	const [lastReadTimestamp, setLastReadTimestamp] = useState(0)

	const relevantEntries = useMemo(() => {
		return (vcpBridgeLogEntries ?? [])
			.filter((entry) => {
				const source = String(entry.source ?? "").toLowerCase()
				const level = String(entry.level ?? "info").toLowerCase()
				if (source.includes("vcpinfo")) {
					return true
				}
				if (source.includes("vcp") && (level === "warn" || level === "error")) {
					return true
				}
				return false
			})
			.slice(-30)
	}, [vcpBridgeLogEntries])

	const latestTimestamp = relevantEntries.length > 0 ? relevantEntries[relevantEntries.length - 1].timestamp : 0
	const unreadCount = relevantEntries.filter((entry) => entry.timestamp > lastReadTimestamp).length

	useEffect(() => {
		if (!open || latestTimestamp <= 0) {
			return
		}
		setLastReadTimestamp((prev) => (latestTimestamp > prev ? latestTimestamp : prev))
	}, [open, latestTimestamp])

	if (vcpConfig?.enabled !== true) {
		return null
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<StandardTooltip content="VCP notifications">
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className={cn(
							"relative h-6 px-2 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground",
							className,
						)}
						data-testid="vcp-info-notifications-trigger">
						<Bell className="w-3.5 h-3.5 mr-1" />
						<span>VCP Info</span>
						{unreadCount > 0 && (
							<span
								className="ml-1 inline-flex items-center justify-center rounded-full bg-vscode-badge-background text-vscode-badge-foreground px-1 min-w-4 h-4 text-[10px] leading-none"
								data-testid="vcp-info-notifications-unread">
								{unreadCount > 99 ? "99+" : unreadCount}
							</span>
						)}
					</Button>
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent align="start" sideOffset={8} className="w-[420px] p-0">
				<div className="px-3 py-2 border-b border-vscode-panel-border text-sm font-medium">VCP 通知</div>
				<div className="max-h-80 overflow-y-auto">
					{relevantEntries.length === 0 ? (
						<div className="px-3 py-3 text-xs text-vscode-descriptionForeground">暂无 VCP 通知。</div>
					) : (
						[...relevantEntries].reverse().map((entry, index) => {
							const level = String(entry.level ?? "info").toLowerCase()
							const levelIcon =
								level === "error" ? (
									<XCircle className="w-3.5 h-3.5 text-vscode-errorForeground" />
								) : level === "warn" ? (
									<AlertTriangle className="w-3.5 h-3.5 text-vscode-editorWarning-foreground" />
								) : (
									<Info className="w-3.5 h-3.5 text-vscode-descriptionForeground" />
								)
							return (
								<div
									key={`${entry.timestamp}-${index}`}
									className="px-3 py-2 border-b border-vscode-panel-border last:border-b-0">
									<div className="flex items-center gap-2 text-xs text-vscode-descriptionForeground">
										{levelIcon}
										<span>{String(entry.source ?? "vcp")}</span>
										<span className="opacity-70">{formatTime(entry.timestamp)}</span>
									</div>
									<div className="mt-1 text-xs whitespace-pre-wrap break-words text-vscode-foreground">
										{entry.message}
									</div>
								</div>
							)
						})
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
