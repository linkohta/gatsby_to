# gatsby-graphiql-explorer

A package to extend the default [GraphiQL](https://github.com/graphql/graphiql) IDE with useful features for Gatsby users.

When using `gatsby develop` it's accessible at `http://localhost:8000/___graphql`.

## Features

- [GraphiQL Query Builder](https://github.com/graphql/graphiql/tree/main/packages/graphiql-plugin-query-builder) - a visual query builder plugin to create queries by clicking through the GraphQL schema
- [GraphiQL Exporter](https://github.com/OneGraph/graphiql-code-exporter) - generates ready-to-run code for your queries
- Button for [Refreshing Content](https://www.gatsbyjs.com/docs/refreshing-content/)
- Support for implied fragments - whether provided by you, core or plugins. Autocompletion, validation & operation execution are all covered
