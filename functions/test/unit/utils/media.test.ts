import {expect, test} from "@jest/globals";
import {
  CHAT_PHOTO_PREFIX,
  DISPATCH_PHOTO_PREFIX,
  FLAG_PHOTO_PREFIX,
} from "../../../constants/media";
import {validatePhotoPaths} from "../../../utils/media";

test("flag photos are scoped to the reporter", () => {
  expect(validatePhotoPaths({
    paths: ["flags/u1/a.jpg"],
    ownerUid: "u1",
    prefix: FLAG_PHOTO_PREFIX,
  })).toEqual(["flags/u1/a.jpg"]);
  expect(() => validatePhotoPaths({
    paths: ["flags/u2/a.jpg"],
    ownerUid: "u1",
    prefix: FLAG_PHOTO_PREFIX,
  })).toThrow("outside its scope");
});

test("dispatch photos are scoped to the ticket", () => {
  expect(validatePhotoPaths({
    paths: ["dispatch/t1/a.jpg"],
    ownerUid: "u1",
    prefix: DISPATCH_PHOTO_PREFIX,
    ticketId: "t1",
  })).toEqual(["dispatch/t1/a.jpg"]);
  expect(() => validatePhotoPaths({
    paths: ["dispatch/t2/a.jpg"],
    ownerUid: "u1",
    prefix: DISPATCH_PHOTO_PREFIX,
    ticketId: "t1",
  })).toThrow("outside its scope");
});

test("chat photos are scoped to the chat ref", () => {
  expect(validatePhotoPaths({
    paths: ["chat/t1/a.jpg"],
    ownerUid: "u1",
    prefix: CHAT_PHOTO_PREFIX,
    chatId: "t1",
  })).toEqual(["chat/t1/a.jpg"]);
  expect(() => validatePhotoPaths({
    paths: ["chat/t2/a.jpg"],
    ownerUid: "u1",
    prefix: CHAT_PHOTO_PREFIX,
    chatId: "t1",
  })).toThrow("outside its scope");
});

test("chat photos require a chat scope", () => {
  expect(() => validatePhotoPaths({
    paths: ["chat/t1/a.jpg"],
    ownerUid: "u1",
    prefix: CHAT_PHOTO_PREFIX,
  })).toThrow("Photo scope is invalid");
});
