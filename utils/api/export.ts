import { ipfsFetch, isIpfsUrl } from "@crossbell/ipfs-fetch";
import JSZip from "jszip";
import yaml from "yaml";

type Database = any;

let db: Database | null = null;
let dbLoadPromise: Promise<Database> | null = null;

async function getSqlJsModule() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const sqlJsModule = await import("sql.js");

	// Handle both default and named exports
	// sql.js exports: { default: initSqlJs, initSqlJs } in some versions
	let initSqlJsFunc = (sqlJsModule as any).default?.initSqlJs || (sqlJsModule as any).initSqlJs;

	// If still not found, the default export might be initSqlJs directly
	if (!initSqlJsFunc && (sqlJsModule as any).default) {
		initSqlJsFunc = (sqlJsModule as any).default;
	}

	if (typeof initSqlJsFunc !== 'function') {
		throw new Error('Failed to load sql.js - initSqlJs is not a function');
	}

	const SQL = await initSqlJsFunc({
		locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
	});
	return SQL;
}

async function decompressGzip(
	compressedData: Uint8Array
): Promise<Uint8Array> {
	// Use native DecompressionStream API
	const blob = new Blob([compressedData.buffer as ArrayBuffer]);
	const stream = blob.stream();
	if (!stream) {
		throw new Error("Failed to create stream from compressed data");
	}

	const decompressedStream = stream.pipeThrough(
		new DecompressionStream("gzip")
	);

	const decompressedResponse = new Response(decompressedStream);
	const arrayBuffer = await decompressedResponse.arrayBuffer();
	return new Uint8Array(arrayBuffer);
}

async function fetchWithProgress(
	url: string,
	onProgress?: (progress: number, statusText: string) => void
): Promise<ArrayBuffer> {
	// Handle split files (xlog.db.gz00, xlog.db.gz01, etc.)
	if (url.endsWith("/xlog.db.gz")) {
		return fetchSplitFiles(url, onProgress);
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
	}

	const contentLength = response.headers.get("Content-Length");
	const total = contentLength ? parseInt(contentLength, 10) : 0;

	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error("Failed to read response body");
	}

	const chunks: Uint8Array[] = [];
	let receivedLength = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		chunks.push(value);
		receivedLength += value.length;

		if (total > 0 && onProgress) {
			const progress = receivedLength / total;
			onProgress(progress * 0.5, `Downloading database... (${Math.round(progress * 100)}%)`);
		}
	}

	const arrayBuffer = new Uint8Array(receivedLength);
	let position = 0;
	for (const chunk of chunks) {
		arrayBuffer.set(chunk, position);
		position += chunk.length;
	}

	return arrayBuffer.buffer;
}

async function fetchSplitFiles(
	baseUrl: string,
	onProgress?: (progress: number, statusText: string) => void
): Promise<ArrayBuffer> {
	// Download all split parts
	const parts: Uint8Array[] = [];
	let partIndex = 0;
	let totalSize = 0;
	let downloadedSize = 0;

	// First, get the size of all parts
	while (true) {
		const partUrl = `${baseUrl}${partIndex.toString().padStart(2, "0")}`;
		const response = await fetch(partUrl, { method: "HEAD" });
		if (!response.ok) break;

		const contentLength = response.headers.get("Content-Length");
		if (contentLength) {
			totalSize += parseInt(contentLength, 10);
		}
		partIndex++;
	}

	if (totalSize === 0) {
		throw new Error("No database parts found");
	}

	// Download all parts
	partIndex = 0;
	while (true) {
		const partUrl = `${baseUrl}${partIndex.toString().padStart(2, "0")}`;
		const response = await fetch(partUrl);
		if (!response.ok) break;

		const contentLength = response.headers.get("Content-Length");
		const partSize = contentLength ? parseInt(contentLength, 10) : 0;

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error("Failed to read response body");
		}

		const chunks: Uint8Array[] = [];
		let receivedLength = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			chunks.push(value);
			receivedLength += value.length;

			if (onProgress) {
				const progress = (downloadedSize + receivedLength) / totalSize;
				onProgress(
					progress * 0.5,
					`Downloading part ${partIndex + 1}... (${Math.round(progress * 100)}%)`
				);
			}
		}

		// Merge chunks for this part
		const partBuffer = new Uint8Array(receivedLength);
		let position = 0;
		for (const chunk of chunks) {
			partBuffer.set(chunk, position);
			position += chunk.length;
		}

		parts.push(partBuffer);
		downloadedSize += receivedLength;
		partIndex++;
	}

	// Merge all parts
	const totalBuffer = new Uint8Array(totalSize);
	let position = 0;
	for (const part of parts) {
		totalBuffer.set(part, position);
		position += part.length;
	}

	return totalBuffer.buffer;
}

async function loadDatabase(
	onProgress?: (progress: number, statusText: string) => void
): Promise<Database> {
	if (db) return db;
	if (dbLoadPromise) return dbLoadPromise;

	dbLoadPromise = (async () => {
		onProgress?.(0, "Initializing SQL.js...");
		const sqlModule = await getSqlJsModule();

		onProgress?.(0, "Downloading database...");
		const compressedArrayBuffer = await fetchWithProgress("/xlog.db.gz", onProgress);

		onProgress?.(0.5, "Decompressing database...");
		const compressedUint8Array = new Uint8Array(compressedArrayBuffer);

		// Decompress using gzip
		const decompressedUint8Array = await decompressGzip(compressedUint8Array);

		onProgress?.(0.9, "Loading database into memory...");
		db = new sqlModule.Database(decompressedUint8Array);
		return db;
	})();

	return dbLoadPromise;
}

export interface NoteMetadata {
	uri?: string;
	content?: {
		_xlog_slug?: string;
		content?: string;
		date_published?: string;
		sources?: string[];
		tags?: string[];
		title?: string;
		attachments?: Array<{
			address?: string;
			content?: string;
			alt?: string;
			mime_type?: string;
		}>;
	};
}

export interface NoteEntity {
	characterId: number;
	noteId: number;
	createdAt: string;
	metadata: NoteMetadata | null;
}

export async function getNotesByCharacterId(
	characterId: number,
	onProgress?: (current: number, total: number) => void
): Promise<NoteEntity[]> {
	const database = await loadDatabase();

	const countResult = database.exec(
		`SELECT COUNT(*) as count FROM notes WHERE characterId = ${characterId}`
	);
	const total = countResult[0]?.values[0]?.[0] as number ?? 0;

	if (total === 0) {
		return [];
	}

	const result = database.exec(
		`SELECT characterId, noteId, createdAt, metadata FROM notes WHERE characterId = ${characterId} ORDER BY createdAt DESC`
	);

	const notes: NoteEntity[] = [];
	if (result.length > 0 && result[0].values) {
		const columns = result[0].columns;
		for (let i = 0; i < result[0].values.length; i++) {
			const row = result[0].values[i];
			const note: NoteEntity = {
				characterId: row[columns.indexOf("characterId")] as number,
				noteId: row[columns.indexOf("noteId")] as number,
				createdAt: row[columns.indexOf("createdAt")] as string,
				metadata: null,
			};

			const metadataStr = row[columns.indexOf("metadata")] as string;
			if (metadataStr) {
				try {
					note.metadata = JSON.parse(metadataStr) as NoteMetadata;
				} catch (e) {
					console.error("Failed to parse metadata:", e);
				}
			}

			notes.push(note);
			onProgress?.(i + 1, total);
		}
	}

	return notes;
}

export async function getAllCharacterIds(): Promise<number[]> {
	const database = await loadDatabase();

	const result = database.exec(
		"SELECT DISTINCT characterId FROM notes ORDER BY characterId"
	);

	const characterIds: number[] = [];
	if (result.length > 0 && result[0].values) {
		for (const row of result[0].values) {
			characterIds.push(row[0] as number);
		}
	}

	return characterIds;
}

export async function exportDataOfCharacter(
	characterId: string,
	{
		onProgress,
		exportNotesInMarkdown = false,
		skipAttachments = false,
	}: {
		onProgress: (progress: number, statusText: string) => void;
		exportNotesInMarkdown: boolean;
		skipAttachments: boolean;
	}
) {
	// Load database with progress
	await loadDatabase(onProgress);

	const charIdNum = parseInt(characterId, 10);
	if (isNaN(charIdNum)) {
		throw new Error("Invalid character ID");
	}

	onProgress(0.01, "Fetching character's notes...");
	let notes: NoteEntity[] = [];
	let notesCount = 0;

	const totalResult = await (async () => {
		const database = await loadDatabase();
		const result = database.exec(
			`SELECT COUNT(*) as count FROM notes WHERE characterId = ${charIdNum}`
		);
		return result[0]?.values[0]?.[0] as number ?? 0;
	})();

	if (totalResult === 0) {
		throw new Error("Character not found or has no notes");
	}

	const database = await loadDatabase();
	const result = database.exec(
		`SELECT characterId, noteId, createdAt, metadata FROM notes WHERE characterId = ${charIdNum} ORDER BY createdAt DESC`
	);

	if (result.length > 0 && result[0].values) {
		const columns = result[0].columns;
		for (let i = 0; i < result[0].values.length; i++) {
			const row = result[0].values[i];
			const note: NoteEntity = {
				characterId: row[columns.indexOf("characterId")] as number,
				noteId: row[columns.indexOf("noteId")] as number,
				createdAt: row[columns.indexOf("createdAt")] as string,
				metadata: null,
			};

			const metadataStr = row[columns.indexOf("metadata")] as string;
			if (metadataStr) {
				try {
					note.metadata = JSON.parse(metadataStr) as NoteMetadata;
				} catch (e) {
					console.error("Failed to parse metadata:", e);
				}
			}

			notes.push(note);
			notesCount++;
		}
	}

	onProgress(0.10, "Compressing data...");
	const zip = new JSZip();

	// Character info
	const characterFolder = zip.folder("character");
	if (!characterFolder) throw new Error("Failed to compress data (character)");
	characterFolder.file(
		"character.json",
		JSON.stringify({ characterId: charIdNum }, null, 2)
	);

	// Notes
	const notesFolder = zip.folder("notes");
	if (!notesFolder) throw new Error("Failed to compress data (notes)");
	notes.forEach((note) => {
		notesFolder.file(
			`${note.characterId}-${note.noteId}.json`,
			JSON.stringify(note, null, 2)
		);
	});

	if (exportNotesInMarkdown) {
		const notesFolder2 = zip.folder("notes-markdown");
		if (!notesFolder2)
			throw new Error("Failed to compress data (notes-markdown)");

		for (let i = 0; i < notes.length; i++) {
			onProgress(
				0.10 + (i / notes.length) * 0.89,
				`Exporting notes & attachments to markdown... (${i + 1}/${notes.length})`
			);
			const note = notes[i];
			await saveNoteInMarkdown(note, notesFolder2, skipAttachments);
		}
	}

	onProgress(0.99, "Generating ZIP file...");
	await zip.generateAsync({ type: "blob" }).then((blob) => {
		downloadFile(blob, `character-${characterId}.zip`);
	});

	onProgress(1, "Done");
}

async function saveNoteInMarkdown(
	note: NoteEntity,
	folder: JSZip,
	skipAttachments: boolean
) {
	let md = note.metadata?.content?.content ?? "";
	if (note.metadata?.content?.title) {
		md = `# ${note.metadata.content.title}

${md}`;
	}

	// append attachments
	if (note.metadata?.content?.attachments) {
		note.metadata.content.attachments.forEach((attachment) => {
			if (attachment.mime_type?.startsWith("image/")) {
				md += `\n\n![${attachment.alt ?? ""}](${
					attachment.address ?? attachment.content
				})`;
			} else if (attachment.mime_type?.startsWith("video/")) {
				md += `\n\n<video src="${
					attachment.address ?? attachment.content
				}" controls></video>`;
			} else if (attachment.mime_type?.startsWith("audio/")) {
				md += `\n\n<audio src="${
					attachment.address ?? attachment.content
				}" controls></audio>`;
			} else {
				md += `\n\n[${attachment.alt ?? ""}](${
					attachment.address ?? attachment.content
				})`;
			}
		});
	}

	// convert all links to relative links
	const { content: newContent, mediaLinks } = convertMediaLinks(md);

	const title = (
		note.metadata?.content?.title ||
		note.metadata?.content?._xlog_slug ||
		md.trim().split("\n")[0].replace("#", "")?.trim().slice(0, 50) ||
		"note"
	).replace(/\/|\\|\?|%|\*|:|\||"|<|>/g, "_");

	md = newContent;

	// prepend metadata to frontmatter
	const frontmatter = {
		characterId: note.characterId,
		noteId: note.noteId,
		createdAt: note.createdAt,
		...note.metadata?.content,
		content: undefined,
		attachments: undefined,
	};
	md =
		`---
${yaml.stringify(frontmatter)}
---\n\n` + md;

	// create note folder
	const noteFolder = folder.folder(
		`${note.characterId}-${note.noteId} - ${title}`
	);
	if (!noteFolder) throw new Error("Failed to compress data (note)");

	// Track failed attachments
	const failedUrls: string[] = [];

	// save attachments
	if (mediaLinks.length > 0) {
		if (skipAttachments) {
			// Skip downloading, treat all as failed
			failedUrls.push(...mediaLinks);
		} else {
			const attachmentsFolder = noteFolder.folder("attachments");
			if (!attachmentsFolder)
				throw new Error("Failed to compress data (attachments)");

			await Promise.all(
				mediaLinks.map(async (mediaLink) => {
					const fileName = mediaLink.split("/").pop();
					if (!fileName) return;
					try {
						const res = isIpfsUrl(mediaLink)
							? await ipfsFetch(mediaLink)
							: await fetch(mediaLink);
						if (!res.ok) {
							throw new Error(`HTTP ${res.status}`);
						}
						const data = await res.blob();
						const fileType = data.type.split("/").pop();
						const baseName = fileName.split(".")[0];
						attachmentsFolder.file(`${baseName}.${fileType}`, data);
						md = md.replaceAll(
							`./attachments/${fileName}`,
							`./attachments/${baseName}.${fileType}`
						); // add file extension to links
					} catch (e) {
						console.error(`Failed to fetch attachment ${mediaLink}`, e);
						failedUrls.push(mediaLink);
						// Keep original link in markdown (do nothing, it's already there)
					}
				})
			);
		}
	}

	// Write failed URLs to file if any
	if (failedUrls.length > 0) {
		noteFolder.file(
			"attach_download_failed.txt",
			failedUrls.join("\n") + "\n"
		);
	}

	// save note
	noteFolder.file(`${title}.md`, md);
}

function convertMediaLinks(content: string) {
	// example: ![alt](https://example.com/image.png "title")
	// the alt and title are optional
	// $1 = alt, $2 = url, $3 = title without quotes
	const imageRegex = /!\[(.*?)\]\((\S*?)\s*("(.*?)")?\)/g;
	const imageHtmlRegex = /<img .*?src="(.*?)"(.*?)>/g;
	const videoRegex = /<video .*?src="(.*?)"(.*?)><\/video>/g;
	const audioRegex = /<audio .*?src="(.*?)"(.*?)><\/audio>/g;

	const protocols = ["https://", "http://", "ipfs://"];

	// Array to store all the media links
	const mediaLinks: string[] = [];

	content = content.replace(imageRegex, (match, alt, url, title) => {
		const oUrl = url;
		mediaLinks.push(url);
		let fileName = title ? title : url.split("/").pop();
		fileName = fileName.replace(/\s+/g, "_");
		protocols.forEach((protocol) => {
			url = url.replace(protocol, "./attachments/");
		});
		return match.replace(oUrl, `./attachments/${fileName}`);
	});

	const replacer = (match: string, url: any) => {
		const oUrl = url;
		mediaLinks.push(url);
		let fileName = url.split("/").pop();
		fileName = fileName.replace(/\s+/g, "_");
		protocols.forEach((protocol) => {
			url = url.replace(protocol, "./attachments/");
		});
		return match.replace(oUrl, `./attachments/${fileName}`);
	};

	content = content.replace(imageHtmlRegex, replacer);

	content = content.replace(videoRegex, replacer);

	content = content.replace(audioRegex, replacer);

	return { content, mediaLinks };
}

function downloadFile(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
}
