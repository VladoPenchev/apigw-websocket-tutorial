"""
get endpoint url by
1. query the stack
2. sys parameter store
"""

import os
import boto3
import json

# api managemnet
client = boto3.client('apigatewaymanagementapi', endpoint_url=os.environ['ENDPOINT_URL'])

# connection table
ddb = boto3.resource('dynamodb')
connections_table = ddb.Table(os.environ['CONNECTIONS_TABLE'])

def handler(event, context):
  """
  send back message to clientid
  """

  # scan connection ids
  connectionIds = []
  try:
    response = connections_table.scan()
    items = response.get('Items', [])
    print(items)
    for item in items:
      connectionIds.append(item['connectionId'])
  except Exception as e:
    print(e)
    return {'statusCode': 500}
  
  # broadcast message to all ids - echo event
  for connectionId in connectionIds:
    response_message = f"lambda response: {event}"
    try:
      client.post_to_connection(ConnectionId=connectionId, Data=json.dumps(response_message))
    except Exception as e:
      print(e)
      return {'statusCode': 500}
    
  return {'statusCode': 200}

