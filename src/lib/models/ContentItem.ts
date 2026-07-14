import { PersistedBaseObject } from '@quatrain/backend';
import { StringProperty, ArrayProperty } from '@quatrain/core';

export const ContentItemProperties = [
   {
      name: 'title',
      type: StringProperty.TYPE,
      mandatory: false
   },
   {
      name: 'category',
      type: StringProperty.TYPE,
      mandatory: false,
      defaultValue: 'inbox'
   },
   {
      name: 'tags',
      type: ArrayProperty.TYPE,
      itemType: StringProperty.TYPE,
      mandatory: false,
      defaultValue: []
   },
   {
      name: 'summary',
      type: StringProperty.TYPE,
      mandatory: false
   },
   {
      name: 'originalFileUri',
      type: StringProperty.TYPE,
      mandatory: false
   },
   {
      name: 'markdownFileUri',
      type: StringProperty.TYPE,
      mandatory: false
   },
   {
      name: 'createdAt',
      type: StringProperty.TYPE,
      mandatory: false
   }
];

export class ContentItem extends PersistedBaseObject {
   static PROPS_DEFINITION = ContentItemProperties;
   static COLLECTION = 'content';

   static async factory(src: any = undefined): Promise<ContentItem> {
      return super.factory(src, ContentItem);
   }
}
