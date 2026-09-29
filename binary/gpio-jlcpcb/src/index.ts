import { run } from "./cli.ts";

const code = await run(process.argv.slice(2), {
	cwd: process.cwd(),
	stdout: (line) => console.log(line),
	stderr: (line) => console.error(line),
});
process.exit(code);
