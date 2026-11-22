<p align="center">
  <a href="https://www.gatsbyjs.com">
    <img alt="Gatsby" src="https://www.gatsbyjs.com/Gatsby-Monogram.svg" width="60" />
  </a>
</p>
<h1 align="center">
  Gatsby
</h1>

<p align="center">
  <strong>
    Web 開発の未来がここに。
  </strong>
</p>
<p align="center">
  Gatsby は React をベースにした無料のオープンソースフレームワークで、驚くほど高速な Web サイトやアプリの構築を支援します。 <br /> 動的にレンダリングされるサイトの制御性とスケーラビリティに、静的サイト生成の速さを組み合わせることで、Web の新しい可能性を切り開きます。
</p>
<p align="center">
  <a href="https://github.com/linkohta/gatsby_to/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Gatsby は MIT ライセンスで公開されています。" />
  </a>
</p>

<h2 align="center">
  <a href="https://www.gatsbyjs.com/docs/quick-start/">クイックスタート</a>
  <span> · </span>
  <a href="https://www.gatsbyjs.com/docs/tutorial/getting-started/">チュートリアル</a>
  <span> · </span>
  <a href="https://www.gatsbyjs.com/plugins/">プラグイン</a>
  <span> · </span>
  <a href="https://www.gatsbyjs.com/starters/">スターター</a>
  <span> · </span>
  <a href="https://www.gatsbyjs.com/showcase/">ショーケース</a>
  <span> · </span>
  <a href="./CLAUDE.md">開発ルール</a>
</h2>

> **このリポジトリについて**
>
> このリポジトリは [gatsbyjs/gatsby](https://github.com/gatsbyjs/gatsby) のフォークです。README とコード内コメントを日本語化し、依存パッケージを更新しながら独自に保守しています。本家の更新は取り込みません。開発ルールは [CLAUDE.md](./CLAUDE.md) を参照してください。
>
> この README からリンクしている公式サイト（gatsbyjs.com）のドキュメントは、本家の Gatsby について英語で書かれたものです。

Gatsby は、保守しやすく、高性能で、コンテンツが豊富な Web サイトを、プロの開発者が効率よく作れるようにします。

- **どこからでもデータを読み込めます。** Gatsby は、Markdown ファイル、Contentful や WordPress のようなヘッドレス CMS、REST API や GraphQL API など、あらゆるデータソースからデータを取り込みます。ソースプラグインでデータを読み込み、Gatsby の統一された GraphQL インターフェースを使って開発できます。

- **静的サイトの枠を超えられます。** 静的サイトの利点をすべて享受しながら、その制約を受けません。Gatsby のサイトは完全に機能する React アプリなので、ブログから EC サイト、ユーザーダッシュボードまで、高品質で動的な Web アプリを作れます。

- **レンダリング方式を選べます。** 静的サイト生成（SSG）に加えて、遅延静的生成（DSG）やサーバーサイドレンダリング（SSR）といった別の[レンダリング方式](https://gatsbyjs.com/docs/conceptual/rendering-options/)を、ページ単位で選べます。このきめ細かな制御により、パフォーマンスと生産性のどちらも犠牲にせずに最適化できます。

- **パフォーマンスが最初から組み込まれています。** 何もしなくてもパフォーマンス監査で高得点を取れます。Gatsby は、コード分割、画像の最適化、クリティカルなスタイルのインライン化、遅延読み込み、リソースのプリフェッチなどを自動化し、手作業でのチューニングなしにサイトを高速にします。

- **すべてのサイトでモダンな技術スタックを使えます。** データの取得元が何であっても、Gatsby のサイトは React と GraphQL で構築します。データが同じバックエンドから来るかどうかにかかわらず、自分とチームのために統一されたワークフローを作れます。

- **わずかな費用で大規模にホスティングできます。** Gatsby のサイトはサーバーを必要としないため、サーバーでレンダリングするサイトと比べてごくわずかな費用で、サイト全体を CDN でホスティングできます。多くの Gatsby サイトは、[Netlify](https://www.netlify.com/) などのサービスで完全に無料でホスティングできます。

[**次のプロジェクトで Gatsby を使う方法を学ぶ。**](https://www.gatsbyjs.com/docs/)

## 🚀 最初の Gatsby サイトを 5 分で公開する

下のリンクをクリックすると、Gatsby と Netlify を使った Web サイトの開発、ビルド、デプロイの流れをすぐに試せます。

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/gatsbyjs/gatsby-starter-blog&utm_source=github&utm_medium=link&utm_campaign=onboarding&utm_content=oss)

この手順を終えると、次のものが手に入ります。

1. Netlify 上で動作するサイト
2. そのサイトに連携された新しいリポジトリ
3. 新しいリポジトリに変更をプッシュするたびに、Netlify がサイトを自動で再ビルドして再デプロイする仕組み

## 💻 ローカル環境で 5 分で Gatsby を始める

次の手順で、新しい Gatsby サイトをローカルの開発環境で 5 分で立ち上げられます。

1. **新しいプロジェクトを初期化します。**

   ```shell
   npm init gatsby
   ```

   名前は「My Gatsby Site」にします。

2. **`develop` モードでサイトを起動します。**

   次に、新しいサイトのディレクトリへ移動して起動します。

   ```shell
   cd my-gatsby-site/
   npm run develop
   ```

3. **ソースコードを開いて編集を始めます。**

   サイトは `http://localhost:8000` で動いています。`my-gatsby-site` ディレクトリを好みのコードエディターで開き、`src/pages/index.js` を編集してください。変更を保存すると、ブラウザーにすぐ反映されます。

これで、完全に機能する Gatsby の Web サイトができました。Gatsby サイトをカスタマイズする方法については、[プラグイン](https://gatsbyjs.com/plugins/)と[公式チュートリアル](https://www.gatsbyjs.com/docs/tutorial/getting-started/)を参照してください。

## 🎓 Gatsby を学ぶ

Gatsby の完全なドキュメントは[公式サイト](https://www.gatsbyjs.com/)にあります。

- **ほとんどの開発者には、[Gatsby でサイトを作る詳細なチュートリアル](https://www.gatsbyjs.com/docs/tutorial/getting-started/)から始めることをおすすめします。** スキルレベルについて何も前提を置かず、すべての手順を順を追って説明しています。

- **コードサンプルをすぐに見たい場合は、[ドキュメント](https://www.gatsbyjs.com/docs/)へ進んでください。** 特に、サイドバーの「<i>How-to Guides</i>」「<i>Reference</i>」「<i>Conceptual Guides</i>」のセクションを確認してください。

**Gatsby の学習を始める: [チュートリアルに沿って進める](https://www.gatsbyjs.com/docs/tutorial/getting-started/) · [ドキュメントを読む](https://www.gatsbyjs.com/docs/)**

## 🚢 リリースノート

本家の Gatsby で最近リリースされた内容は、[リリースノート](https://www.gatsbyjs.com/docs/reference/release-notes)で確認できます。主なハイライト、パフォーマンスの改善、新機能、注目すべきバグ修正がまとめられています。

Gatsby の各バージョンに対するサポート方針については、[バージョンサポートのドキュメント](https://www.gatsbyjs.com/docs/reference/release-notes/gatsby-version-support/)を参照してください。

## 💼 移行ガイド

すでに Gatsby サイトをお持ちの場合は、次のガイドを使うと、ゼロから作り直さずに Gatsby v5 の改善点をサイトへ取り入れられます。

- [v4 から v5 への移行](https://www.gatsbyjs.com/docs/reference/release-notes/migrating-from-v4-to-v5/)
- [v3 から v4 への移行](https://www.gatsbyjs.com/docs/reference/release-notes/migrating-from-v3-to-v4/)
- [v2 から v3 への移行](https://www.gatsbyjs.com/docs/reference/release-notes/migrating-from-v2-to-v3/)

## ❗ 行動規範

Gatsby は、誰もが歓迎され、多様で、安全なコミュニティを築くことに尽力しています。Gatsby コミュニティに参加するすべての人に、[**行動規範**](https://www.gatsbyjs.com/contributing/code-of-conduct/)を守ることを求めます。

## 🤝 開発に参加する

このリポジトリで開発する際は、[**CLAUDE.md**](./CLAUDE.md) の開発ルールに従ってください。セットアップの手順、コードとコメントの書き方、依存パッケージの更新方針、リファクタリング方針、コミットと PR のルールをまとめています。

本家の Gatsby へコントリビュートする場合は、本家の[**コントリビューションガイド**](https://www.gatsbyjs.com/contributing/)を参照してください。

### このリポジトリの構成について

このリポジトリは、[Lerna](https://github.com/lerna/lerna) で管理している[モノレポ](https://trunkbaseddevelopment.com/monorepos/)です。つまり、このコードベースでは[複数のパッケージ](./packages)をまとめて管理しています。

## 📝 ライセンス

[MIT ライセンス](./LICENSE)のもとで公開されています。

## 💜 謝辞

プラグイン、スターター、動画、ブログ記事を作ってくださった、本家 Gatsby の多くのコントリビューターの皆さんに感謝します。Issue や PR を手伝い、GitHub Discussions で質問に答えてくださったコミュニティの皆さんにも、特別な感謝を捧げます。

Gatsby を素晴らしいものにしているのは、コミュニティの一人ひとりです。皆さんの貢献が、Gatsby の体験を日々より良いものにしています。
