export function Placeholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p>{blurb}</p>
      <p className="muted">This page is being built.</p>
    </section>
  );
}
