import Footer from "@/components/Home/Footer";
import Form from "@/components/Home/Form";

export default function Page({
	searchParams,
}: {
	searchParams: { characterId?: string; md?: string };
}) {
	return (
		<div className="min-h-screen flex flex-col justify-center items-center">
			<main className="container mx-auto flex flex-col justify-center items-center">
				<h1 className="text-3xl font-semibold">Export xLog Data</h1>
				<p className="my-4">You own your data?</p>

				{/* Warning message */}
				<div className="alert alert-warning w-full max-w-xs mb-4">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						className="stroke-current shrink-0 h-6 w-6"
						fill="none"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
					<span className="text-xs">
						xLog 的 IPFS 目前没有在 pin 了，很多附件可能无法下载。
						如果附件下载挂起时间过长，建议开“仅保留附件URL”选项。
						尽快导出附件吧，IPFS上还剩下的附件随时会消失更多。
					</span>
				</div>

				<div className="alert alert-warning w-full max-w-xs mb-4">
					<span className="text-xs">
						<p>	要获取自己的 Character ID，请在
							<a href="https://github.com/saveweb/xloglog/blob/main/xlog_cid_title_map.csv" className="underline">xlog_cid_title_map.csv</a>
							中查找你以前发过的博文标题对应的 Character ID。
						</p>
					</span>
				</div>

				<Form characterId={searchParams.characterId} md={searchParams.md} />
			</main>

			<Footer />
		</div>
	);
}
