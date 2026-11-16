/** "The request was wrong": one class for every store and handler, so an
 *  instanceof check catches it wherever it was thrown. No AWS here. */
export class BadRequest extends Error {}
