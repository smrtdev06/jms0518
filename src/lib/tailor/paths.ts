import path from "node:path";

export const rootDir = process.cwd();

// Template PDFs and the styles read from them, deployed with the code (uploads go to the database).
export const templateDir = path.join(rootDir, "templates");
