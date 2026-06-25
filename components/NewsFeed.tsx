import type { NewsItem } from "@/lib/types";
import { timeAgo } from "@/lib/format";

export default function NewsFeed({ items }: { items: NewsItem[] }) {
  if (items.length === 0) {
    return (
      <div className="news-item">
        <div>
          <div className="title">No headlines available right now.</div>
          <div className="src">
            The geopolitical feed updates every few minutes.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="news">
      {items.map((it, i) => (
        <a
          key={i}
          className="news-item"
          href={it.link}
          target="_blank"
          rel="noopener noreferrer"
        >
          <div>
            <div className="title">{it.title}</div>
            <div className="src">
              {it.source}
              {it.publishedAt ? ` · ${timeAgo(it.publishedAt)}` : ""}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
