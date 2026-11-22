/*
 * ProductVariantPricePair オブジェクトは、Shopify のほかのオブジェクトとは異なる。
 * オブジェクトではあるが id フィールドを持たないためである。
 * そのため、@link ディレクティブで参照するほかのオブジェクトとは違い、
 * オブジェクトに直接付ける必要がある。
 */

/*
 * key: ノードの参照フィールドの名前
 * coupled: ノードがほかのノードに結び付いているか、トップレベルか
 * optionalKey: ノードがプラグインオプションで任意に含められる場合のキー
 * imageFields: 画像オブジェクトを持つフィールドの配列
 * referenceFields: ほかのノードを参照するすべてのフィールドを定義する配列
 * coupledNodeFields: そのオブジェクトが無効化されたときに無効化される、参照フィールドのキーの配列
 */

// eslint-disable @typescript-eslint/naming-convention

interface IShopifyTypes {
  [key: string]: {
    key?: string
    coupled: boolean
    optionalKey?: string
    imageFields?: Array<string>
    referenceFields?: Array<string>
    coupledNodeFields?: Array<string>
  }
}

export const shopifyTypes: IShopifyTypes = {
  Collection: {
    key: `collections___NODE`,
    coupled: false,
    optionalKey: `collections`,
    imageFields: [`image`],
    referenceFields: [`products___NODE`, `metafields___NODE`],
    coupledNodeFields: [`metafields___NODE`],
  },
  ExternalVideo: {
    key: `media___NODE`,
    coupled: true,
    imageFields: [`preview.image`],
  },
  InventoryItem: {
    coupled: true,
    referenceFields: [`inventoryLevels___NODE`],
    coupledNodeFields: [`inventoryLevels___NODE`],
  },
  InventoryLevel: {
    key: `inventoryLevels___NODE`,
    coupled: true,
  },
  LineItem: {
    key: `lineItems___NODE`,
    coupled: true,
  },
  Location: {
    coupled: false,
    optionalKey: `locations`,
  },
  Media: {
    coupled: true,
  },
  MediaImage: {
    key: `media___NODE`,
    coupled: true,
    imageFields: [`image`, `preview.image`],
  },
  Metafield: {
    key: `metafields___NODE`,
    coupled: true,
  },
  Model3d: {
    key: `media___NODE`,
    coupled: true,
    imageFields: [`preview.image`],
  },
  Order: {
    coupled: false,
    optionalKey: `orders`,
    referenceFields: [`lineItems___NODE`],
    coupledNodeFields: [`lineItems___NODE`],
  },
  Product: {
    key: `products___NODE`,
    coupled: false,
    imageFields: [`featuredImage`],
    referenceFields: [
      `media___NODE`,
      `variants___NODE`,
      `metafields___NODE`,
      `collections___NODE`,
    ],
    coupledNodeFields: [`media___NODE`, `variants___NODE`, `metafields___NODE`],
  },
  ProductVariant: {
    key: `variants___NODE`,
    coupled: true,
    imageFields: [`image`],
    referenceFields: [
      `inventoryLevels___NODE`,
      `metafields___NODE`,
      `media___NODE`,
    ],
    coupledNodeFields: [
      `inventoryLevels___NODE`,
      `metafields___NODE`,
      `media___NODE`,
    ],
  },
  Video: {
    key: `media___NODE`,
    coupled: true,
    imageFields: [`preview.image`],
  },
  ProductVariantPricePair: {
    key: `presentmentPrices`,
    coupled: true,
  },
}
