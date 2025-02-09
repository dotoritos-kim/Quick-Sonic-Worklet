export const removeFileName = (path: string): string => {
	if (path.startsWith("http://") || path.startsWith("https://")) {
		// HTTP 경로 처리
		return path.substring(0, path.lastIndexOf("/"));
	} else {
		// 운영체제 경로 처리 (Windows 또는 Unix)
		const separator = path.includes("\\") ? "\\" : "/";
		return path.substring(0, path.lastIndexOf(separator));
	}
};
