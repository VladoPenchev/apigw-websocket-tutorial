import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

export class CdkInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //api gateway
    const apigw = new cdk.aws_apigatewayv2.CfnApi(this, 'ApiGwSocket', {
      name: "ApiGwSocket",
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "$request.body.action",
    })    

    // table to store connections id
    const connectionIdTable = new cdk.aws_dynamodb.Table(this, 'ConnectionIdTable', {
      tableName: 'ConnectionIdTable',
      partitionKey: { 
        name: 'connectionId', type: cdk.aws_dynamodb.AttributeType.STRING         
      },
      readCapacity: 5,
      writeCapacity: 5,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    //connect lambda
    const connectFunc = new cdk.aws_lambda.Function(this, 'connectFunc', {
        functionName: 'connectFunc',
        code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, './../lambdas')),
        handler: 'connect.handler',
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_13,
        timeout: cdk.Duration.seconds(300),
        memorySize: 512,
        environment: {
          CONNECTIONS_TABLE: connectionIdTable.tableName,
        },      
    });
    connectionIdTable.grantReadWriteData(connectFunc);

    //disconnect lambda
    const disconnectFunc = new cdk.aws_lambda.Function(this, 'disconnectFunc', {
        functionName: 'disconnectFunc',
        code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, './../lambdas')),
        handler: 'disconnect.handler',
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_13,
        timeout: cdk.Duration.seconds(300),
        memorySize: 512,
        environment: {
          CONNECTIONS_TABLE: connectionIdTable.tableName,
        },      
    });
    connectionIdTable.grantReadWriteData(disconnectFunc);

    //send message lambda
    const sendMessageFunc = new cdk.aws_lambda.Function(this, 'sendMessageFunc', {
        functionName: 'sendMessageFunc',
        code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, './../lambdas')),
        handler: 'sendMessage.handler',
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_13,
        timeout: cdk.Duration.seconds(300),
        memorySize: 512,
        environment: {
          CONNECTIONS_TABLE: connectionIdTable.tableName,
          ENDPOINT_URL: `https://${apigw.ref}.execute-api.${this.region}.amazonaws.com/dev`,
        },
        initialPolicy: [
          new cdk.aws_iam.PolicyStatement({
            effect: cdk.aws_iam.Effect.ALLOW,
            // send messages to apigw
            actions: ['execute-api:ManageConnections'],
            resources: ["*"],
          }),
        ],      
    });
    connectionIdTable.grantReadWriteData(sendMessageFunc);

    // role for apigw to invoke three lambdas
    const roleForApiGwInvokeLambda = new cdk.aws_iam.Role(this, '"RoleForApiGwInvokeLambda', {
      roleName: 'RoleForApiGwInvokeLambda',
      assumedBy: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com')
    });
    roleForApiGwInvokeLambda.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [
        connectFunc.functionArn, 
        disconnectFunc.functionArn, 
        sendMessageFunc.functionArn],
    }));

    // connection integration
    const connectIntegration = new cdk.aws_apigatewayv2.CfnIntegration(this, 'connectIntegration', {
      apiId: apigw.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${connectFunc.functionArn}/invocations`,
      credentialsArn: roleForApiGwInvokeLambda.roleArn
    });

    // disconnect integration
    const disconnectIntegration = new cdk.aws_apigatewayv2.CfnIntegration(this, 'disconnectIntegration', {
      apiId: apigw.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${disconnectFunc.functionArn}/invocations`,
      credentialsArn: roleForApiGwInvokeLambda.roleArn
    });
    

    // send message integration
    const sendMessageIntegration = new cdk.aws_apigatewayv2.CfnIntegration(this, 'sendMessageIntegration', {
      apiId: apigw.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${sendMessageFunc.functionArn}/invocations`,
      credentialsArn: roleForApiGwInvokeLambda.roleArn
    });

    // connect route
    const connectRoute = new cdk.aws_apigatewayv2.CfnRoute(this, 'ConnectRoute', {
      apiId: apigw.ref,
      routeKey: '$connect',
      authorizationType: 'NONE',
      target: `integrations/${connectIntegration.ref}`
    });

    // disconnect route
    const disconnectRoute = new cdk.aws_apigatewayv2.CfnRoute(this, 'DisconnectRoute', {
      apiId: apigw.ref,
      routeKey: '$disconnect',
      authorizationType: 'NONE',
      target: `integrations/${disconnectIntegration.ref}`
    });

    // send message route
    const sendMessageRoute = new cdk.aws_apigatewayv2.CfnRoute(this, 'SendMessageRoute', {
      apiId: apigw.ref,
      routeKey: 'sendmessage',
      authorizationType: 'NONE',
      target: `integrations/${sendMessageIntegration.ref}`
    });

    // deployment stage
    const deployment = new cdk.aws_apigatewayv2.CfnDeployment(this, 'Deployment', {
      apiId: apigw.ref,
    });

    new cdk.aws_apigatewayv2.CfnStage(this, 'DevStage', {
      apiId: apigw.ref,
      stageName: 'dev',
      deploymentId: deployment.ref,
      autoDeploy: true,
    });

    // need three routs ready before we can deploy
    deployment.addDependency(connectRoute);
    deployment.addDependency(disconnectRoute);
    deployment.addDependency(sendMessageRoute);

    //output
    new cdk.CfnOutput(this, 'WebSocketURL', {
      value: `wss://${apigw.ref}.execute-api.${this.region}.amazonaws.com/dev`,
    });
  }
}
