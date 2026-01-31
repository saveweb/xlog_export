export default function Footer() {
	return (
		<footer className="fixed bottom-5 left-0 right-0 text-center">
			<nav className="flex flex-row justify-center space-x-5">
				<a
					className="link link-hover"
					href="https://xlog.app"
					target="_blank"
					rel="noopener noreferrer"
				>
					xLog.app(寄)
				</a>

				<a
					className="link link-hover"
					href="https://github.com/saveweb/xlog_export"
					target="_blank"
					rel="noopener noreferrer"
				>
					Source
				</a>

				<a
					className="link link-hover"
					href="https://saveweb.org"
					target="_blank"
					rel="noopener noreferrer"
				>
					Save The Web Project
				</a>
			</nav>
		</footer>
	);
}
