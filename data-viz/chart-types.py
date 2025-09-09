#!/usr/bin/env python3
"""
Cheat Sheet: Viz Approaches by Item Count
- Hierarchical, area-proportional treemaps (binary split, alternating orientation)
- Circular bubble cloud and beeswarm
- Tailwind-like 500 palette (provided)

Usage:
  pip install matplotlib numpy
  python cheat_sheet_viz.py

This script prints a few progress messages so you can trace the pipeline.
"""

import math
import numpy as np
import matplotlib.pyplot as plt

# ----------------------------
# Palette (Tailwind-ish 500s)
# ----------------------------
PALETTE = [
    "#64748b", # Slate 500
    "#ef4444", # Red 500
    "#f97316", # Orange 500
    "#eab308", # Yellow 500
    "#84cc16", # Lime 500
    "#22c55e", # Green 500
    "#14b8a6", # Teal 500
    "#0ea5e9", # Sky 500
    "#3b82f6", # Blue 500
    "#6366f1", # Indigo 500
    "#a855f7", # Purple 500
    "#ec4899", # Pink 500
]

# -------------------------------------------
# Deterministic randomness for repeatability
# -------------------------------------------
np.random.seed(42)


# ---------------------------------------------------------
# Hierarchical binary-split treemap (no external deps)
# - Sorts values descending
# - Recursively splits the rectangle by cumulative halves
# - Alternates orientation by aspect ratio
# ---------------------------------------------------------
def draw_binary_treemap(ax, values, colors=PALETTE, title="Treemap", depth_limit=12):
    print(f"[treemap] start: {title}, n={len(values)}")

    vals = np.array(values, dtype=float)
    vals = vals[vals > 0]
    if len(vals) == 0:
        print("[treemap] no positive values — skipping")
        ax.axis("off")
        ax.set_title(title)
        return

    vals = np.sort(vals)[::-1]  # largest-first

    def recurse(x, y, w, h, arr, depth=0, color_idx=0):
        # Base case: paint this cell
        if depth > depth_limit or len(arr) == 1:
            c = colors[color_idx % len(colors)]
            ax.add_patch(plt.Rectangle(
                (x, y), w, h,
                facecolor=c, edgecolor="white", linewidth=0.8
            ))
            return color_idx + 1

        # Split arr into two groups with roughly equal sum
        total = arr.sum()
        csum = np.cumsum(arr)
        split_idx = np.searchsorted(csum, total / 2.0)
        left = arr[:max(1, split_idx)]
        right = arr[max(1, split_idx):]

        # Choose split direction by current aspect (simple heuristic)
        if w >= h:
            # vertical split
            lw = w * left.sum() / total
            color_idx = recurse(x, y, lw, h, left, depth + 1, color_idx)
            color_idx = recurse(x + lw, y, w - lw, h, right, depth + 1, color_idx)
        else:
            # horizontal split
            lh = h * left.sum() / total
            color_idx = recurse(x, y, w, lh, left, depth + 1, color_idx)
            color_idx = recurse(x, y + lh, w, h - lh, right, depth + 1, color_idx)
        return color_idx

    recurse(0, 0, 1, 1, vals, 0, 0)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.set_title(title)
    print(f"[treemap] done: {title}")


# ---------------------------------------------------------
# Utility to scatter filled circles with consistent styling
# ---------------------------------------------------------
def scatter_circles(ax, x, y, sizes, palette=PALETTE, title="", alpha=0.8, edge="#64748b"):
    n = len(x)
    colors = [palette[i % len(palette)] for i in range(n)]
    ax.scatter(
        x, y,
        s=sizes,
        c=colors,
        alpha=alpha,
        marker="o",
        linewidths=0.6,
        edgecolors=edge
    )
    if title:
        ax.set_title(title)
    ax.set_xticks([])
    ax.set_yticks([])


# ---------------------------------------------------------
# Main: build the 4x4 cheat sheet figure
# ---------------------------------------------------------
def build_cheat_sheet():
    print("[build] generating sample data…")
    # Small / medium / large / very large samples
    small = [5, 3, 2]
    medium = list(range(1, 11))
    large = list(range(1, 31))
    very_large = list(range(1, 101))

    print("[build] creating figure …")
    fig, axs = plt.subplots(4, 4, figsize=(12, 12))

    # ---- Row 1: 1–5 items ----
    axs[0, 0].bar(["A", "B", "C"], small, color=PALETTE[:3])
    axs[0, 0].set_title("Bar (1–5)")
    axs[0, 0].set_xticks([]); axs[0, 0].set_yticks([])

    axs[0, 1].plot(small, ["A", "B", "C"], "o", color=PALETTE[1])
    axs[0, 1].set_title("Dot plot")
    axs[0, 1].set_xticks([]); axs[0, 1].set_yticks([])

    draw_binary_treemap(axs[0, 2], small, title="Treemap (1–5)")

    axs[0, 3].pie(small, labels=["A", "B", "C"], colors=PALETTE[:3])
    axs[0, 3].set_title("Pie")

    # ---- Row 2: 6–15 items ----
    axs[1, 0].barh(range(len(medium)), medium, color=PALETTE[:len(medium)])
    axs[1, 0].set_title("Horizontal Bar")
    axs[1, 0].set_xticks([]); axs[1, 0].set_yticks([])

    axs[1, 1].stem(medium, linefmt=":", markerfmt="o", basefmt=" ")
    axs[1, 1].set_title("Lollipop")
    axs[1, 1].set_xticks([]); axs[1, 1].set_yticks([])

    scatter_circles(
        axs[1, 2],
        x=list(range(len(medium))),
        y=[1] * len(medium),
        sizes=[m * 10 for m in medium],
        title="Bubble"
    )
    axs[1, 2].axis("off")

    mat = np.array([[1, 3, 2, 0], [0, 2, 4, 1], [3, 1, 0, 4], [2, 4, 1, 3]])
    axs[1, 3].imshow(mat, cmap="Blues")
    axs[1, 3].set_title("Heatmap")
    axs[1, 3].set_xticks([]); axs[1, 3].set_yticks([])

    # ---- Row 3: 20–100 items ----
    axs[2, 0].barh(range(len(large)), large,
                   color=[PALETTE[i % len(PALETTE)] for i in range(len(large))])
    axs[2, 0].set_title("Bar (scroll)")
    axs[2, 0].set_xticks([]); axs[2, 0].set_yticks([])

    axs[2, 1].plot(large, "o", color=PALETTE[5])
    axs[2, 1].set_title("Dot density")
    axs[2, 1].set_xticks([]); axs[2, 1].set_yticks([])

    draw_binary_treemap(axs[2, 2], large, title="Treemap (20–100)")

    # “bubble cloud”: random placement, size ~ value (first 30)
    n_cloud = 30
    bx = np.random.rand(n_cloud)
    by = np.random.rand(n_cloud)
    bs = [large[i] for i in range(n_cloud)]
    scatter_circles(axs[2, 3], bx, by, sizes=bs, title="Bubble cloud")

    # ---- Row 4: 100+ items ----
    topk = sorted(very_large, reverse=True)[:20]
    axs[3, 0].bar(range(len(topk)), topk, color=[PALETTE[i % len(PALETTE)] for i in range(len(topk))])
    axs[3, 0].set_title("Pareto (top 20)")
    axs[3, 0].set_xticks([]); axs[3, 0].set_yticks([])

    # beeswarm (approx): jittered grid with circular markers
    grid_cols = 10
    grid_rows = 10
    x = np.repeat(np.linspace(0.05, 0.95, grid_cols), grid_rows)
    y = np.tile(np.linspace(0.05, 0.95, grid_rows), grid_cols)
    jitter = 0.03
    x = x + (np.random.rand(x.size) - 0.5) * jitter
    y = y + (np.random.rand(y.size) - 0.5) * jitter
    scatter_circles(axs[3, 1], x, y, sizes=[50] * x.size, title="Beeswarm")
    axs[3, 1].set_xlim(0, 1); axs[3, 1].set_ylim(0, 1)

    draw_binary_treemap(axs[3, 2], very_large, title="Treemap (100+)")

    axs[3, 3].text(0.5, 0.5, "Interactive\nFiltering",
                   ha="center", va="center", fontsize=10)
    axs[3, 3].set_title("Interactive")
    axs[3, 3].axis("off")

    # Common formatting
    for ax in axs.flat:
        # We’ve already hidden most ticks; ensure consistency.
        ax.set_xticks([])
        ax.set_yticks([])

    plt.tight_layout()
    plt.suptitle(
        "Cheat Sheet: Viz Approaches by Item Count (Hierarchical Treemaps + Circles)",
        fontsize=14, y=1.02
    )

    print("[build] rendering figure …")
    plt.show()
    print("[build] done.")


if __name__ == "__main__":
    build_cheat_sheet()