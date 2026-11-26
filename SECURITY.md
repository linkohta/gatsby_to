# セキュリティポリシー

このリポジトリは [gatsbyjs/gatsby](https://github.com/gatsbyjs/gatsby) のフォークで、本家とは別に保守しています。このリポジトリで見つけた脆弱性は、本家ではなく、このリポジトリへ報告してください。

## サポート対象のバージョン

セキュリティ更新の対象は、`master` ブランチにある最新のコード（Gatsby 5.x）だけです。

| バージョン | サポート           |
| ---------- | ------------------ |
| 5.x        | :heavy_check_mark: |
| 4.x 以前   | :x:                |

## 脆弱性の報告

脆弱性を見つけた場合は、公開の Issue には書かず、GitHub の[非公開の脆弱性報告](https://github.com/linkohta/gatsby_to/security/advisories/new)（リポジトリの「Security」タブの「Report a vulnerability」）から報告してください。

報告には、問題の詳しい説明と再現手順を含めてください。情報が詳しいほど、再現と対応の判断がしやすくなります。

本家の Gatsby にも同じ問題がある場合は、本家の[セキュリティポリシー](https://github.com/gatsbyjs/gatsby/security/policy)に沿って、本家にも報告してください。

`npm audit` や `yarn audit` の結果をそのまま報告することは控えてください。依存パッケージについて報告される問題は把握していて、定期的に確認しています。多くの場合、Gatsby の利用者にとって実際に悪用できるリスクにはなりません。実際に悪用できることを確認できた場合は、その手順を添えて報告してください。
