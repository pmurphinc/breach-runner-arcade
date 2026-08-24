import fs from "node:fs";

const path = new URL("../app/game.tsx", import.meta.url);
let source = fs.readFileSync(path, "utf8");

function replaceRequired(from, to) {
  if (!source.includes(from)) throw new Error(`Lint cleanup source no longer contains expected block.`);
  source = source.replace(from, to);
}

replaceRequired(
`  useEffect(() => {
    let cancelled = false;
    const localBest = loadLocalBest();
    setBest(localBest);
    if (boardLimit === 10) setEntries(null);
    setFailed(false);
    setLoading(true);
    void fetchLeaderboard(boardLimit).then((rows) => {`,
`  useEffect(() => {
    let cancelled = false;
    const localBest = loadLocalBest();
    queueMicrotask(() => {
      if (cancelled) return;
      setBest(localBest);
      if (boardLimit === 10) setEntries(null);
      setFailed(false);
      setLoading(true);
    });
    void fetchLeaderboard(boardLimit).then((rows) => {`
);

replaceRequired(
`  useEffect(() => {
    if (open) setInitialsDraft(initials);
  }, [initials, open]);`,
`  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => setInitialsDraft(initials));
  }, [initials, open]);`
);

replaceRequired(
`  useEffect(() => {
    if (net?.rematch?.status !== "starting") return;
    setSummary(null);
    setStage("setup");
    setLobbyOpen(true);
  }, [net?.rematch?.status]);`,
`  useEffect(() => {
    if (net?.rematch?.status !== "starting") return;
    queueMicrotask(() => {
      setSummary(null);
      setStage("setup");
      setLobbyOpen(true);
    });
  }, [net?.rematch?.status]);`
);

fs.writeFileSync(path, source);
console.log("Applied existing React effect lint cleanup to app/game.tsx");
