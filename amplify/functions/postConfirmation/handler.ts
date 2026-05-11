import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  GetGroupCommand,
  CreateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { PostConfirmationTriggerHandler } from "aws-lambda";

const cognito = new CognitoIdentityProviderClient({});

const DEFAULT_GROUP = process.env.DEFAULT_GROUP || "dhc-welcome";

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const { userPoolId, userName } = event;

  // Ensure the group exists (idempotent — defineAuth declares it, but the
  // group may not have been provisioned yet on the very first sign-up).
  try {
    await cognito.send(
      new GetGroupCommand({ GroupName: DEFAULT_GROUP, UserPoolId: userPoolId })
    );
  } catch {
    try {
      await cognito.send(
        new CreateGroupCommand({
          GroupName: DEFAULT_GROUP,
          UserPoolId: userPoolId,
          Description: "Default tier — assigned on user sign-up confirmation",
        })
      );
    } catch (err) {
      console.warn("[postConfirmation] CreateGroup failed (race?):", err);
    }
  }

  await cognito.send(
    new AdminAddUserToGroupCommand({
      GroupName: DEFAULT_GROUP,
      UserPoolId: userPoolId,
      Username: userName,
    })
  );

  return event;
};
