<?php declare(strict_types=1); ?>
        .progress-card { margin: 1.5rem 0 2.5rem; padding: 1.5rem; border-radius: 1rem; background: linear-gradient(145deg, #f3f4ff, #fefefe); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.06); }
        .progress-details { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; justify-content: space-between; }
        .progress-bar { position: relative; flex: 1 1 220px; height: 16px; border-radius: 999px; background: rgba(0, 0, 0, 0.08); overflow: hidden; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #5c6df4, #9a4ef1); transition: width 0.3s ease; }
        .progress-bar::after { content: ''; position: absolute; inset: 0; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4); border-radius: 999px; }
        .progress-summary { margin: 0; font-size: 1rem; color: #333; }
        .progress-summary strong { font-size: 1.2rem; }
        .progress-note { margin-top: 0.75rem; color: #555; font-size: 0.95rem; }
        @media (max-width: 600px) {
            .progress-card { padding: 1.25rem; }
            .progress-details { flex-direction: column; align-items: flex-start; }
            .progress-bar { width: 100%; max-width: none; }
            .progress-summary { font-size: 0.95rem; }
        }

        @media (max-width: 420px) {
            .progress-details { gap: 0.5rem; }
            .progress-bar { display: none; }
            .progress-summary {
                font-size: 1rem;
                width: 100%;
            }
        }
