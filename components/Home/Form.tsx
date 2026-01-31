"use client";
import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { exportDataOfCharacter } from "../../utils/api/export";

export default function Form({
	characterId: qCharacterId = "",
	md: qMd,
}: {
	characterId?: string;
	md?: string;
}) {
	const qEnableMd = qMd ? qMd !== "false" && qMd !== "0" : false;

	// values
	const [characterId, setCharacterId] = useState(qCharacterId);
	const [options, setOptions] = useState({
		notesInMarkdown: qEnableMd ?? false,
		skipAttachments: false,
	});

	useEffect(() => {
		setCharacterId(qCharacterId);
		setOptions((v) => ({ ...v, notesInMarkdown: qEnableMd ?? false }));
	}, [qCharacterId, qEnableMd]);

	// export
	const [status, setStatus] = useState<
		"idle" | "loading" | "success" | "error"
	>("idle");
	const [message, setMessage] = useState("");
	const [progress, setProgress] = useState(0);
	const handleExportData = useCallback(async () => {
		try {
			setStatus("loading");
			setMessage("");
			await exportDataOfCharacter(characterId, {
				onProgress: (progress, statusText) => {
					setProgress(progress);
					setMessage(statusText);
				},
				exportNotesInMarkdown: options.notesInMarkdown,
				skipAttachments: options.skipAttachments,
			});
			setStatus("success");
			setMessage("Success!");
		} catch (e: any) {
			setStatus("error");
			setMessage(e.message);
		}
	}, [characterId, options.notesInMarkdown, options.skipAttachments]);

	// input
	const handleInputCharacterId = useCallback((e: any) => {
		setCharacterId(e.target.value);
		setStatus("idle");
		setMessage("");
	}, []);

	return (
		<section className="form-control w-full max-w-xs">
			<input
				type="text"
				placeholder="Type your character ID here"
				className="input input-bordered w-full max-w-xs"
				value={characterId}
				onChange={handleInputCharacterId}
				disabled={status === "loading"}
			/>

			<div className="my-2"></div>

			<label className="label cursor-pointer">
				<span className="label-text text-xs">
					Also export notes & attachments in markdown files (开启才能导出附件，推荐开启。否则只有 JSON 元数据)
				</span>
				<input
					type="checkbox"
					className="toggle toggle-primary"
					checked={options.notesInMarkdown}
					onChange={(e) =>
						setOptions((v) => ({
							...v,
							notesInMarkdown: e.target.checked,
						}))
					}
					disabled={status === "loading"}
				/>
			</label>

			<div className="my-2"></div>

			<label className="label cursor-pointer">
				<span className="label-text text-xs">
					Skip downloading attachments (仅保留附件 URL，不下载附件文件。如果附件错误太多导出卡住，开这个)
				</span>
				<input
					type="checkbox"
					className="toggle toggle-secondary"
					checked={options.skipAttachments}
					onChange={(e) =>
						setOptions((v) => ({
							...v,
							skipAttachments: e.target.checked,
						}))
					}
					disabled={status === "loading"}
				/>
			</label>

			<div className="my-2"></div>

			<button
				className={clsx("btn btn-primary", {
					"btn-disabled": !characterId,
					loading: status === "loading",
				})}
				onClick={handleExportData}
			>
				{status === "loading"
					? `Export (${(progress * 100).toFixed(1)}%)`
					: "Export (需加载至少100MB数据，注意流量)"}
			</button>

			<div className="my-2"></div>

			{/* progress */}
			{status !== "idle" && (
				<progress
					className={clsx("progress w-full transition-colors", {
						"progress-primary": status === "loading",
						"progress-success": status === "success",
						"progress-error": status === "error",
					})}
					value={progress * 100}
					max="100"
				></progress>
			)}

			{/* message */}
			{message && (
				<div
					className={clsx("text-xs", {
						"text-error": status === "error",
						"text-success": status === "success",
					})}
				>
					{message}
				</div>
			)}
		</section>
	);
}
