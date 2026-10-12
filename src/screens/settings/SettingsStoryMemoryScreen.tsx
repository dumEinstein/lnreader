import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { TextInput } from 'react-native-paper';

import { Appbar, Dialog, List, SafeAreaView } from '@components';
import { useTheme } from '@hooks/persisted';
import {
  isStoryModelConfigured,
  StoryMemorySettings,
  useStoryMemorySettings,
} from '@hooks/persisted/useStoryMemorySettings';
import { getString } from '@i18n/translations';
import { StoryMemorySettingsScreenProps } from '@navigators/types';
import { queueStoryMemoryIndexing } from '@services/storyMemory';
import { createOpenAiCompatibleModel } from '@services/storyMemory/openAiCompatibleModel';
import { showToast } from '@utils/showToast';

type EditableField = 'baseUrl' | 'model' | 'apiKey' | 'contextTokens';

const FIELD_LABELS: Record<
  EditableField,
  {
    title: Parameters<typeof getString>[0];
    description: Parameters<typeof getString>[0];
  }
> = {
  baseUrl: {
    title: 'storyMemory.baseUrl',
    description: 'storyMemory.baseUrlDescription',
  },
  model: {
    title: 'storyMemory.model',
    description: 'storyMemory.modelDescription',
  },
  apiKey: {
    title: 'storyMemory.apiKey',
    description: 'storyMemory.apiKeyDescription',
  },
  contextTokens: {
    title: 'storyMemory.contextTokens',
    description: 'storyMemory.contextTokensDescription',
  },
};

const StoryMemorySettingsScreen = ({
  navigation,
}: StoryMemorySettingsScreenProps) => {
  const theme = useTheme();
  const settings = useStoryMemorySettings();
  const { setStoryMemorySettings } = settings;
  const [editing, setEditing] = useState<EditableField>();
  const [draft, setDraft] = useState('');
  const [testing, setTesting] = useState(false);

  const openEditor = (field: EditableField) => {
    setDraft(String(settings[field]));
    setEditing(field);
  };

  const saveDraft = () => {
    if (!editing) return;
    const value = draft.trim();
    const update: Partial<StoryMemorySettings> =
      editing === 'contextTokens'
        ? {
            contextTokens:
              Number.parseInt(value, 10) > 0
                ? Number.parseInt(value, 10)
                : settings.contextTokens,
          }
        : { [editing]: value };
    setStoryMemorySettings(update);
    setEditing(undefined);
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const models = await createOpenAiCompatibleModel(
        settings,
      ).checkConnection();
      showToast(
        getString('storyMemory.connectionOk', {
          models: models.join(', ') || '-',
        }),
      );
    } catch (error) {
      showToast(
        getString('storyMemory.connectionFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setTesting(false);
    }
  };

  const describe = (field: EditableField) => {
    const value = String(settings[field]).trim();
    if (!value) return getString('storyMemory.notSet');
    return field === 'apiKey' ? getString('storyMemory.apiKeySet') : value;
  };

  const configured = isStoryModelConfigured(settings);

  return (
    <SafeAreaView excludeTop>
      <Appbar
        title={getString('storyMemory.title')}
        handleGoBack={() => navigation.goBack()}
        theme={theme}
      />
      <ScrollView>
        <List.Section>
          <List.SubHeader theme={theme}>
            {getString('storyMemory.serverSection')}
          </List.SubHeader>
          {(Object.keys(FIELD_LABELS) as EditableField[]).map(field => (
            <List.Item
              key={field}
              title={getString(FIELD_LABELS[field].title)}
              description={describe(field)}
              onPress={() => openEditor(field)}
              theme={theme}
            />
          ))}
          <List.Item
            title={getString('storyMemory.testConnection')}
            disabled={!settings.baseUrl.trim() || testing}
            onPress={testConnection}
            theme={theme}
          />
        </List.Section>
        <List.Section>
          <List.SubHeader theme={theme}>
            {getString('storyMemory.indexingSection')}
          </List.SubHeader>
          <List.Item
            title={getString('storyMemory.indexNow')}
            description={getString('storyMemory.indexNowDescription', {
              count: settings.enabledNovelIds.length,
            })}
            disabled={!configured || !settings.enabledNovelIds.length}
            onPress={queueStoryMemoryIndexing}
            theme={theme}
          />
          <List.InfoItem
            title={getString('storyMemory.privacyNote')}
            theme={theme}
          />
        </List.Section>
      </ScrollView>

      <Dialog.Root
        visible={editing !== undefined}
        onDismiss={() => setEditing(undefined)}
      >
        {editing ? (
          <>
            <Dialog.Title>
              {getString(FIELD_LABELS[editing].title)}
            </Dialog.Title>
            <Dialog.Description>
              {getString(FIELD_LABELS[editing].description)}
            </Dialog.Description>
            <Dialog.Content>
              <TextInput
                mode="outlined"
                value={draft}
                onChangeText={setDraft}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={editing === 'apiKey'}
                keyboardType={
                  editing === 'contextTokens'
                    ? 'number-pad'
                    : editing === 'baseUrl'
                    ? 'url'
                    : 'default'
                }
                placeholderTextColor={theme.onSurfaceDisabled}
                style={[{ color: theme.onSurface }, styles.textInput]}
                theme={{ colors: { ...theme } }}
              />
            </Dialog.Content>
          </>
        ) : null}
        <Dialog.Actions>
          <Dialog.Action
            onPress={() => setEditing(undefined)}
            title={getString('common.cancel')}
          />
          <Dialog.Action onPress={saveDraft} title={getString('common.save')} />
        </Dialog.Actions>
      </Dialog.Root>
    </SafeAreaView>
  );
};

export default StoryMemorySettingsScreen;

const styles = StyleSheet.create({
  textInput: {
    fontSize: 14,
  },
});
